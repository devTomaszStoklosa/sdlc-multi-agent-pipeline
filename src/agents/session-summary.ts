import { z } from "zod";
import { redactText } from "../hooks/redact.ts";

const MAX_MESSAGE = 3000;

const resultSchema = z.looseObject({
  subtype: z.string().optional(),
  is_error: z.boolean().optional(),
  num_turns: z.number().optional(),
  duration_ms: z.number().optional(),
  total_cost_usd: z.number().optional(),
  usage: z.record(z.string(), z.unknown()).optional(),
  result: z.string().optional(),
});

const recordSchema = z.looseObject({
  tool: z.string().optional(),
  decision: z.string(),
  blocks: z.array(z.looseObject({ category: z.string() })).optional(),
  redactions: z.number().optional(),
});

type SessionResult = z.infer<typeof resultSchema>;
type AuditRecord = z.infer<typeof recordSchema>;

function countBy(values: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const parts = [...counts].map(
    ([value, count]) => `${value} ${String(count)}`,
  );
  return parts.length === 0 ? "none" : parts.join(", ");
}

function sessionLines(result: SessionResult): string[] {
  return [
    `- Result: ${result.subtype ?? "unknown"}, error: ${String(result.is_error ?? "unknown")}`,
    `- Turns: ${String(result.num_turns ?? "unknown")}, duration: ${String(result.duration_ms ?? "unknown")} ms`,
    `- Estimated cost (usage measure, not a charge): ${String(result.total_cost_usd ?? "unknown")} USD`,
    `- Usage: ${JSON.stringify(result.usage ?? {})}`,
  ];
}

// The Stop hook writes its decisions to the same log as the tool calls.
const STOP_HOOK = "Stop";

function auditLines(all: readonly AuditRecord[]): string[] {
  const records = all.filter((record) => record.tool !== STOP_HOOK);
  const stops = all.filter((record) => record.tool === STOP_HOOK);
  const categories = records.flatMap((record) =>
    (record.blocks ?? []).map((block) => block.category),
  );
  const redactions = records.reduce(
    (sum, record) => sum + (record.redactions ?? 0),
    0,
  );
  const failedTools = records
    .filter((record) => record.decision === "failed")
    .map((record) => record.tool ?? "unknown");
  return [
    `- Tool calls: ${countBy(records.map((record) => record.decision))}`,
    `- Failed tool calls: ${countBy(failedTools)}`,
    `- Stop hook: ${countBy(stops.map((record) => record.decision))}`,
    `- Blocks by category: ${countBy(categories)}`,
    `- Redactions in tool output: ${String(redactions)}`,
  ];
}

// A Markdown summary of an agent session for the public workflow log: the
// result and usage reported by `claude -p --output-format json` and the tool
// calls from the audit log. It holds no transcript, and the final message is
// redacted (plan 4).
export function summarize(resultText: string, auditText: string): string {
  const result = resultSchema.parse(resultText ? JSON.parse(resultText) : {});
  const records = auditText
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => recordSchema.parse(JSON.parse(line)));
  const message = redactText(result.result ?? "").value.slice(0, MAX_MESSAGE);
  return [
    "## Agent session",
    "",
    ...sessionLines(result),
    ...auditLines(records),
    "",
    "### Final message",
    "",
    "```text",
    message.replaceAll("```", "'''"),
    "```",
    "",
  ].join("\n");
}
