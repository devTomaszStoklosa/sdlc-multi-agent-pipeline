// The SAST gate (QG-7.2) of the gates workflow: compares the CodeQL results
// of a pull request with those of its base commit.
// Usage: sast-gate <base-sarif-dir> <head-sarif-dir> <fail-on>
// Each directory holds the .sarif files of one commit, one per language.
// Exit codes: 0 passed, 1 failed, 2 usage or read error.
import { appendFile, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { SEVERITY_LEVELS } from "../../config/schema.ts";
import { newAlerts, parseAlerts, type Alert, type Severity } from "./sarif.ts";

async function readAlerts(dir: string): Promise<Alert[]> {
  const files = (await readdir(dir, { recursive: true })).filter((file) =>
    file.endsWith(".sarif"),
  );
  if (files.length === 0) throw new Error(`No .sarif file in ${dir}.`);
  const texts = await Promise.all(
    files.map((file) => readFile(path.join(dir, file), "utf8")),
  );
  return texts.flatMap(parseAlerts);
}

function isSeverity(value: string): value is Severity {
  return (SEVERITY_LEVELS as readonly string[]).includes(value);
}

function report(found: readonly Alert[], failOn: Severity): string {
  if (found.length === 0) {
    return `No new security alert at severity ${failOn} or above.`;
  }
  return [
    `New security alerts at severity ${failOn} or above:`,
    ...found.map(
      (alert) =>
        `- ${alert.ruleId} (${String(alert.severity)}) at ${alert.location}`,
    ),
  ].join("\n");
}

async function main(args: readonly string[]): Promise<number> {
  const [baseDir, headDir, failOn = ""] = args;
  if (baseDir === undefined || headDir === undefined || !isSeverity(failOn)) {
    console.error(
      `Usage: sast-gate <base-sarif-dir> <head-sarif-dir> <${SEVERITY_LEVELS.join("|")}>`,
    );
    return 2;
  }
  try {
    const [base, head] = await Promise.all([
      readAlerts(baseDir),
      readAlerts(headDir),
    ]);
    const found = newAlerts(base, head, failOn);
    const text = report(found, failOn);
    console.log(text);
    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (summary) await appendFile(summary, `${text}\n`);
    return found.length === 0 ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
}

process.exitCode = await main(process.argv.slice(2));
