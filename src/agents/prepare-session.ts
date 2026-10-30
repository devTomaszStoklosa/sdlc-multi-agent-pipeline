// Writes the files an agent session needs: the hook context and the Claude Code
// settings with the pipeline hooks.
// Usage: prepare-session --role <role> --workspace <dir> --config <.sdlc-agents.yml> --out <dir>
// The output directory must be outside the workspace, so the agent cannot
// change its own hooks. Exit codes: 0 written, 1 invalid configuration, 2
// usage or read error.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { parseOrgBaseline } from "../config/parse.ts";
import { isRole, type Role } from "../hooks/roles.ts";
import { writeSessionFiles } from "./session-files.ts";

const BASELINE_PATH = fileURLToPath(
  new URL("../../config/org-baseline.yml", import.meta.url),
);

interface Options {
  role: Role;
  workspace: string;
  config: string;
  out: string;
}

function options(args: readonly string[]): Options | undefined {
  try {
    const { values } = parseArgs({
      args: [...args],
      options: {
        role: { type: "string" },
        workspace: { type: "string" },
        config: { type: "string" },
        out: { type: "string" },
      },
    });
    const { role = "", workspace, config, out } = values;
    if (!isRole(role) || !workspace || !config || !out) return undefined;
    return { role, workspace, config, out };
  } catch {
    return undefined;
  }
}

async function prepare(given: Options): Promise<number> {
  const [configText, baselineText] = await Promise.all([
    readFile(given.config, "utf8"),
    readFile(BASELINE_PATH, "utf8"),
  ]);
  const baseline = parseOrgBaseline(baselineText);
  if (!baseline.ok) throw new Error(baseline.errors.join("\n"));
  const result = await writeSessionFiles({
    role: given.role,
    workspace: given.workspace,
    configText,
    baseline: baseline.value,
    out: given.out,
  });
  if (!result.ok) {
    console.error(
      [`${given.config} is invalid:`, ...result.errors].join("\n  - "),
    );
    return 1;
  }
  console.log(
    `Wrote the ${given.role} session files to ${path.resolve(given.out)}.`,
  );
  return 0;
}

async function main(args: readonly string[]): Promise<number> {
  const given = options(args);
  if (given === undefined) {
    console.error(
      "Usage: prepare-session --role <role> --workspace <dir> --config <.sdlc-agents.yml> --out <dir>",
    );
    return 2;
  }
  try {
    return await prepare(given);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
}

process.exitCode = await main(process.argv.slice(2));
