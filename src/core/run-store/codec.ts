import { runRecordSchema, type RunRecord } from "./run-record.ts";

const MARKER = "sdlc-run-state";
const BLOCK = new RegExp(`<!-- ${MARKER}\\n([\\s\\S]*?)\\n-->`);

export type DecodeResult =
  | { found: false }
  | { found: true; ok: true; record: RunRecord }
  | { found: true; ok: false; error: string };

// The state lives in a hidden HTML comment. The configuration copy may hold
// `--`, which could end the HTML comment, so every `--` in the JSON is
// written with an escaped second hyphen. `--` cannot occur in JSON outside a
// string.
export function encodeRecord(record: RunRecord): string {
  const json = JSON.stringify(record).replaceAll("--", "-\\u002d");
  const { state } = record.run.progress;
  return [
    `**Stan przebiegu pipeline'u:** \`${state}\` (przebieg ${record.run.id}). Komentarz aktualizuje pipeline.`,
    "",
    `<!-- ${MARKER}`,
    json,
    "-->",
  ].join("\n");
}

export function decodeRecord(body: string): DecodeResult {
  const match = BLOCK.exec(body);
  if (match?.[1] === undefined) return { found: false };
  try {
    const parsed = runRecordSchema.safeParse(JSON.parse(match[1]));
    if (parsed.success) return { found: true, ok: true, record: parsed.data };
    return { found: true, ok: false, error: parsed.error.message };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { found: true, ok: false, error: reason };
  }
}
