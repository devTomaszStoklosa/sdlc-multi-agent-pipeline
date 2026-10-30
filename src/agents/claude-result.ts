import { z } from "zod";
import { redactText } from "../hooks/redact.ts";
import type { RoleFailure, RoleUsage } from "./role-runner.ts";

const MAX_MESSAGE = 500;

export interface ProcessRun {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

const tokens = z.number().min(0).optional();

// The result of `claude -p --output-format json`. Only the fields the job
// uses are checked; the CLI may add others.
const cliResultSchema = z.looseObject({
  subtype: z.string().optional(),
  is_error: z.boolean().optional(),
  result: z.string().optional(),
  num_turns: z.number().min(0).optional(),
  total_cost_usd: z.number().min(0).optional(),
  usage: z
    .looseObject({
      input_tokens: tokens,
      cache_creation_input_tokens: tokens,
      cache_read_input_tokens: tokens,
      output_tokens: tokens,
    })
    .optional(),
  structured_output: z.unknown().optional(),
});

type CliResult = z.infer<typeof cliResultSchema>;

// The Pro plan's limit (plan 2.2). Claude Code reports it as an error result,
// sometimes with the reset time as Unix seconds after a `|`.
const USAGE_LIMIT = /usage limit|hit your limit|limit reached|rate limit/i;
const RESET_SECONDS = /\|(\d{10})\b/;

function whole(value: number | undefined): number {
  return Math.floor(value ?? 0);
}

// Usage of the session (NFR-11.4). Input counts the cached tokens too,
// because they count towards the plan's limits.
function usageOf(result: CliResult | undefined): RoleUsage {
  const usage = result?.usage;
  return {
    input_tokens:
      whole(usage?.input_tokens) +
      whole(usage?.cache_creation_input_tokens) +
      whole(usage?.cache_read_input_tokens),
    output_tokens: whole(usage?.output_tokens),
    cost_usd: result?.total_cost_usd ?? 0,
    turns: whole(result?.num_turns),
  };
}

// A message for the job's log and output: redacted and short, because it
// may quote the session.
function message(text: string): string {
  return redactText(text).value.slice(0, MAX_MESSAGE);
}

function parse(stdout: string): CliResult | undefined {
  try {
    const parsed = cliResultSchema.safeParse(JSON.parse(stdout.trim()));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function failed(
  failure: RoleFailure,
  text: string,
  result: CliResult | undefined,
  resetsAt?: string,
) {
  return {
    status: "failed" as const,
    failure,
    message: message(text),
    usage: usageOf(result),
    ...(resetsAt === undefined ? {} : { resetsAt }),
  };
}

function errorOf(result: CliResult) {
  const text = result.result ?? "";
  if (result.subtype === "error_max_turns") {
    return failed("max-turns", "The session reached its turn limit.", result);
  }
  if (USAGE_LIMIT.test(text)) {
    const seconds = RESET_SECONDS.exec(text)?.[1];
    const resetsAt =
      seconds === undefined
        ? undefined
        : new Date(Number(seconds) * 1000).toISOString();
    return failed("usage-limit", text, result, resetsAt);
  }
  return failed("infra", `${result.subtype ?? "error"}: ${text}`, result);
}

// The role result of a finished `claude -p` process. `toOutput` turns the
// session's structured output into the role's output, which the job
// validates; anything else is a failure of the stage.
export function toRoleResult(
  run: ProcessRun,
  toOutput: (structured: unknown) => unknown,
): unknown {
  const result = parse(run.stdout);
  if (result === undefined) {
    return failed(
      "infra",
      `claude exited with code ${String(run.exitCode)} without a result: ${run.stderr.slice(-MAX_MESSAGE)}`,
      undefined,
    );
  }
  if (result.is_error === true || result.subtype !== "success") {
    return errorOf(result);
  }
  if (result.structured_output === undefined) {
    return failed(
      "infra",
      "The session returned no structured output.",
      result,
    );
  }
  return {
    status: "ok",
    output: toOutput(result.structured_output),
    usage: usageOf(result),
  };
}
