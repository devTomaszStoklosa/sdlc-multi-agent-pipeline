import { z } from "zod";
import type { RoleUsage } from "./role-runner.ts";

// The events of `claude -p --output-format stream-json --verbose`, one JSON
// object per line. The stream holds the session's thinking and tool inputs,
// so the job keeps it in memory and never writes it to a file (plan 4).

const tokens = z.number().min(0).optional();

const assistantSchema = z.looseObject({
  type: z.literal("assistant"),
  message: z.looseObject({
    id: z.string(),
    usage: z
      .looseObject({
        input_tokens: tokens,
        cache_creation_input_tokens: tokens,
        cache_read_input_tokens: tokens,
        output_tokens: tokens,
      })
      .optional(),
  }),
});

function events(stdout: string): unknown[] {
  return stdout.split("\n").flatMap((line) => {
    if (line.trim() === "") return [];
    try {
      return [JSON.parse(line) as unknown];
    } catch {
      return [];
    }
  });
}

function isResult(event: unknown): boolean {
  return (
    typeof event === "object" &&
    event !== null &&
    (event as { type?: unknown }).type === "result"
  );
}

// The session's result: the last `result` event, which system events may
// follow.
export function resultEvent(stdout: string): unknown {
  return events(stdout).findLast(isResult);
}

function whole(value: number | undefined): number {
  return Math.floor(value ?? 0);
}

// The usage of a session that ended without a result, from its assistant
// messages (#61). A message comes once per content block, each with the
// usage so far, so the last one of each message counts. The input tokens and
// turns are exact; the output tokens are a lower bound, and the cost is
// unknown, because only the result reports it.
export function partialUsage(stdout: string): RoleUsage {
  const last = new Map<string, z.infer<typeof assistantSchema>>();
  for (const event of events(stdout)) {
    const parsed = assistantSchema.safeParse(event);
    if (parsed.success) last.set(parsed.data.message.id, parsed.data);
  }
  let input = 0;
  let output = 0;
  for (const { message } of last.values()) {
    const usage = message.usage;
    input +=
      whole(usage?.input_tokens) +
      whole(usage?.cache_creation_input_tokens) +
      whole(usage?.cache_read_input_tokens);
    output += whole(usage?.output_tokens);
  }
  return {
    input_tokens: input,
    output_tokens: output,
    cost_usd: 0,
    turns: last.size,
  };
}

// What the session summary gets for an aborted session instead of a result.
export function abortedResult(usage: RoleUsage): object {
  return {
    subtype: "aborted",
    num_turns: usage.turns,
    usage: {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
    },
    partial_usage: true,
  };
}
