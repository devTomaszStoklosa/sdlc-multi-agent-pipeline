// Prints the summary of an agent session.
// Usage: session-summary --result <result.json> --audit <tool-calls.jsonl>
// A missing file counts as empty, so a session that failed early still gets a
// summary.
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { summarize } from "./session-summary.ts";

async function readOptional(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return "";
  }
}

async function main(args: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...args],
    options: { result: { type: "string" }, audit: { type: "string" } },
  });
  if (values.result === undefined || values.audit === undefined) {
    console.error("Usage: session-summary --result <file> --audit <file>");
    return 2;
  }
  const [resultText, auditText] = await Promise.all([
    readOptional(values.result),
    readOptional(values.audit),
  ]);
  process.stdout.write(summarize(resultText, auditText));
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
