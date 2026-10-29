import type { ToolPolicy } from "../policy.ts";
import { invocations, type SimpleCommand } from "../shell/parse.ts";

const PRINTENV = new Set(["printenv"]);
const ENV = new Set(["env"]);
// Shell builtins that list variables when run without names.
const LISTING_BUILTINS = new Set(["export", "declare", "typeset", "set"]);
const COMPGEN = new Set(["compgen"]);
// Ways to read the environment from code or from another process.
const ENVIRONMENT_READS = [
  /\/proc\/[^/\s]+\/environ/,
  /\bprocess\.env\b/,
  /\bos\.environ\b/,
  /\bgetenv\b/,
  /\bENV\[/,
];
// A reference to a variable whose name looks like a credential.
const SECRET_VARIABLE =
  /\$\{?[A-Za-z0-9_]*(TOKEN|SECRET|PASSW(OR)?D|API_?KEY|PRIVATE_?KEY|CREDENTIAL)/i;

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

// `env` with only options and assignments prints the environment, while
// `env NAME=value command` runs a command.
function printsWithEnv(args: readonly string[]): boolean {
  return args.every((arg) => arg.startsWith("-") || ASSIGNMENT.test(arg));
}

function listsVariables(command: SimpleCommand): boolean {
  const [program, ...args] = command.words;
  if (program === undefined || !LISTING_BUILTINS.has(program)) return false;
  return args.every((arg) => arg.startsWith("-"));
}

function dumpsEnvironment(command: SimpleCommand): boolean {
  return (
    invocations(command, PRINTENV).length > 0 ||
    invocations(command, ENV).some(printsWithEnv) ||
    invocations(command, COMPGEN).some((args) => args.includes("-e")) ||
    listsVariables(command)
  );
}

// Agents may not read environment variables, where tokens live (SEC-9.3, plan
// 4). Claude Code also removes credentials from the environment of the shell
// (CLAUDE_CODE_SUBPROCESS_ENV_SCRUB), so this is the second layer.
export const environmentSecrets: ToolPolicy = {
  name: "environment-secrets",
  category: "secrets",
  check(call) {
    const reads =
      call.commands.some(dumpsEnvironment) ||
      ENVIRONMENT_READS.some((pattern) => pattern.test(call.line)) ||
      SECRET_VARIABLE.test(call.line);
    if (!reads) return undefined;
    return "Agents may not read environment variables, because they may hold secrets.";
  },
};
