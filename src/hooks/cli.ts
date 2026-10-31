// Entry point of the Claude Code hooks of an agent session.
// Usage: cli.ts <pre-tool-use|post-tool-use|post-tool-use-failure|stop> --context <hook-context.json>
// Claude Code passes the hook input on standard input. Exit code 2 blocks the
// action. Any failure blocks too (SEC-9.0a): here, and through the
// `onFailure: "block"` setting when the process cannot even start.
import { readFile } from "node:fs/promises";
import { text } from "node:stream/consumers";
import { JsonlToolCallLog } from "../audit/tool-log.ts";
import { SandboxedCommandRunner } from "./commands.ts";
import { hookContextSchema } from "./context.ts";
import { BLOCK_EXIT_CODE, type HookResponse } from "./events.ts";
import { runFailClosed } from "./fail-closed.ts";
import {
  DEADLINE_MARGIN_MS,
  HOOK_EVENTS,
  type HookEvent,
} from "./hook-events.ts";

async function handle(
  event: HookEvent,
  contextPath: string,
  rawInput: string,
): Promise<HookResponse> {
  const context = hookContextSchema.parse(
    JSON.parse(await readFile(contextPath, "utf8")),
  );
  const dependencies = {
    log: new JsonlToolCallLog(context.audit_log),
    runner: new SandboxedCommandRunner(
      context.workspace,
      event.commandTimeoutMs,
    ),
    installer: new SandboxedCommandRunner(
      context.workspace,
      event.installTimeoutMs,
      true,
    ),
    now: () => new Date(),
  };
  return event.handle(JSON.parse(rawInput), context, dependencies);
}

async function main(args: readonly string[]): Promise<HookResponse> {
  const [eventName = "", flag, contextPath] = args;
  const event = HOOK_EVENTS.get(eventName);
  if (
    event === undefined ||
    flag !== "--context" ||
    contextPath === undefined
  ) {
    return {
      exitCode: BLOCK_EXIT_CODE,
      stderr: `Usage: cli.ts <${[...HOOK_EVENTS.keys()].join("|")}> --context <file>`,
    };
  }
  const rawInput = await text(process.stdin);
  return runFailClosed(
    event.name,
    rawInput,
    () => handle(event, contextPath, rawInput),
    event.timeoutSeconds * 1000 - DEADLINE_MARGIN_MS,
  );
}

const response = await main(process.argv.slice(2));
if (response.stderr !== undefined) process.stderr.write(response.stderr);
// A command the hook started may still run after a missed deadline, so the
// process exits once the answer is written.
process.stdout.write(response.stdout ?? "", () => {
  process.exit(response.exitCode);
});
