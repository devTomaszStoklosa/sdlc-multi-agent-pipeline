// The configuration job of the gates workflow (QG-7.1 to QG-7.8, FR-10.2).
// Usage: gate-config <path-to-.sdlc-agents.yml>
// The file comes from the base commit of the pull request, so a pull request
// cannot change its own gates. The commands and thresholds go to the file in
// GITHUB_OUTPUT. Exit codes: 0 written, 1 invalid configuration, 2 usage or
// read error. A missing file is invalid (FR-10.1).
import { randomUUID } from "node:crypto";
import { appendFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseOrgBaseline } from "../../config/parse.ts";
import { validateRepoConfig } from "../../config/validate.ts";
import { formatOutputs, gateOutputs } from "./outputs.ts";

const BASELINE_PATH = fileURLToPath(
  new URL("../../../config/org-baseline.yml", import.meta.url),
);

async function readConfig(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

async function main(args: readonly string[]): Promise<number> {
  const [configPath] = args;
  const outputPath = process.env.GITHUB_OUTPUT;
  if (configPath === undefined || args.length !== 1 || !outputPath) {
    console.error("Usage: gate-config <path-to-.sdlc-agents.yml>");
    return 2;
  }
  const baseline = parseOrgBaseline(await readFile(BASELINE_PATH, "utf8"));
  if (!baseline.ok) {
    console.error(baseline.errors.join("\n"));
    return 2;
  }
  const configText = await readConfig(configPath);
  if (configText === undefined) {
    console.error(
      "The base commit has no .sdlc-agents.yml, so the gates have no configuration (FR-10.1).",
    );
    return 1;
  }
  const result = validateRepoConfig(configText, baseline.value);
  if (!result.ok) {
    console.error(
      [".sdlc-agents.yml is invalid:", ...result.errors].join("\n  - "),
    );
    return 1;
  }
  const outputs = gateOutputs(result.effective);
  await appendFile(outputPath, formatOutputs(outputs, `EOF_${randomUUID()}`));
  const { install, build, test, lint, format, coverage, ...thresholds } =
    outputs;
  console.log(
    JSON.stringify(
      {
        commands: { install, build, test, lint, format, coverage },
        thresholds,
      },
      null,
      2,
    ),
  );
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
