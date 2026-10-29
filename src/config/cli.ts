// Validates a repository's .sdlc-agents.yml against the organization baseline.
// Usage: npm run validate-config -- <path-to-.sdlc-agents.yml>
// Exit codes: 0 valid, 1 invalid configuration, 2 usage or read error.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseOrgBaseline } from "./parse.ts";
import { validateRepoConfig } from "./validate.ts";

const BASELINE_PATH = fileURLToPath(
  new URL("../../config/org-baseline.yml", import.meta.url),
);

function printErrors(title: string, errors: readonly string[]): void {
  console.error([title, ...errors.map((error) => `  - ${error}`)].join("\n"));
}

async function read(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`Cannot read ${path}: ${reason}`);
    return undefined;
  }
}

async function main(args: readonly string[]): Promise<number> {
  const [configPath] = args;
  if (configPath === undefined || args.length !== 1) {
    console.error("Usage: validate-config <path-to-.sdlc-agents.yml>");
    return 2;
  }
  const [configText, baselineText] = await Promise.all([
    read(configPath),
    read(BASELINE_PATH),
  ]);
  if (configText === undefined || baselineText === undefined) return 2;

  const baseline = parseOrgBaseline(baselineText);
  if (!baseline.ok) {
    printErrors(
      `Invalid organization baseline ${BASELINE_PATH}:`,
      baseline.errors,
    );
    return 2;
  }
  const result = validateRepoConfig(configText, baseline.value);
  if (!result.ok) {
    printErrors(`${configPath} is invalid:`, result.errors);
    return 1;
  }
  console.log(`${configPath} is valid.`);
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
