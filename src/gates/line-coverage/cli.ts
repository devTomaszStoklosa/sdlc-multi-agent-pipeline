// The coverage gate (QG-7.6) of the gates workflow.
// Usage: coverage-gate <base-summary.json> <head-summary.json> <tolerance>
// A missing base report means that the base commit has no coverage.
// Exit codes: 0 passed, 1 failed, 2 usage or read error.
import { readFile } from "node:fs/promises";
import { checkCoverage, linePct } from "./coverage.ts";

async function basePct(path: string): Promise<number | undefined> {
  try {
    return linePct(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function main(args: readonly string[]): Promise<number> {
  const [basePath, headPath, tolerance] = args;
  if (basePath === undefined || headPath === undefined || !tolerance) {
    console.error(
      "Usage: coverage-gate <base-summary.json> <head-summary.json> <tolerance>",
    );
    return 2;
  }
  try {
    const result = checkCoverage(
      await basePct(basePath),
      linePct(await readFile(headPath, "utf8")),
      Number(tolerance),
    );
    console.log(result.message);
    return result.passed ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
}

process.exitCode = await main(process.argv.slice(2));
