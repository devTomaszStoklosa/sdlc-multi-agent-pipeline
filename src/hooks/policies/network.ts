import type { HookContext } from "../context.ts";
import type { ToolCall, ToolPolicy } from "../policy.ts";
import { invocations, type SimpleCommand } from "../shell/parse.ts";

// Programs that open connections without a URL in their arguments.
const NETWORK_PROGRAMS = new Set([
  "ssh",
  "scp",
  "sftp",
  "nc",
  "ncat",
  "netcat",
  "telnet",
  "ftp",
  "tftp",
  "socat",
]);
// Download programs, which must name their target as a full URL.
const DOWNLOADERS = new Set(["curl", "wget", "http", "https"]);
const URL_AUTHORITY = /\b[a-z][a-z0-9+.-]*:\/\/([^\s/'"`?#\\]+)/gi;
// The host of an scp-style address, as in `git@example.com:repo.git`.
const SCP_HOST = /\b[\w.-]+@([\w-]+(?:\.[\w-]+)+):/g;

// The host of a URL authority, without the user name and port.
function hostOf(authority: string): string {
  const host = authority.slice(authority.lastIndexOf("@") + 1);
  return host.replace(/:\d*$/, "").toLowerCase();
}

function hostsIn(text: string): string[] {
  return [
    ...[...text.matchAll(URL_AUTHORITY)].map((match) => hostOf(match[1] ?? "")),
    ...[...text.matchAll(SCP_HOST)].map((match) =>
      (match[1] ?? "").toLowerCase(),
    ),
  ];
}

function opensConnection(command: SimpleCommand): boolean {
  return (
    invocations(command, NETWORK_PROGRAMS).length > 0 ||
    invocations(command, DOWNLOADERS).some(
      (args) => !args.some((arg) => arg.includes("://")),
    )
  );
}

function shellProblem(
  call: ToolCall,
  context: HookContext,
): string | undefined {
  if (call.commands.some(opensConnection)) {
    return "Agents may open connections only with a full URL to an allowed host.";
  }
  const host = hostsIn(call.line).find(
    (found) => !context.rules.allowed_hosts.includes(found),
  );
  return host === undefined ? undefined : `${host} is not an allowed host.`;
}

function fetchProblem(url: unknown, context: HookContext): string | undefined {
  const host = typeof url === "string" ? URL.parse(url)?.hostname : undefined;
  if (host !== undefined && context.rules.allowed_hosts.includes(host)) {
    return undefined;
  }
  return `${String(url)} is not on an allowed host.`;
}

// Agents connect only to the hosts of network.allowed_hosts in the baseline
// (SEC-8.4, SEC-9.4). Shell commands are checked by the URLs they contain, so
// the runner sandbox is the second layer (SEC-9.0c).
export const network: ToolPolicy = {
  name: "network",
  category: "network",
  check(call, context) {
    if (call.tool === "WebSearch") return "Agents may not search the web.";
    if (call.tool === "WebFetch") return fetchProblem(call.input.url, context);
    return shellProblem(call, context);
  },
};
