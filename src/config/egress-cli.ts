// Prints the allowed-endpoints of a job's harden-runner step, one per line, to
// paste into its workflow after a change of src/config/egress.ts or of
// network.allowed_hosts in the baseline (SEC-8.4).
// Usage: npm run egress -- <workflow-file> <job-id>
// Exit codes: 0 printed, 2 usage error or unknown job.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { JOB_GROUPS, allowedEndpoints } from "./egress.ts";
import { parseOrgBaseline } from "./parse.ts";

const BASELINE_PATH = fileURLToPath(
  new URL("../../config/org-baseline.yml", import.meta.url),
);

async function main(args: readonly string[]): Promise<number> {
  const [file, job] = args;
  const groups =
    file === undefined || job === undefined
      ? undefined
      : JOB_GROUPS[file]?.[job];
  if (groups === undefined || args.length !== 2) {
    console.error(
      "Usage: egress <workflow-file> <job-id>, e.g. gates.yml lint",
    );
    return 2;
  }
  const baseline = parseOrgBaseline(await readFile(BASELINE_PATH, "utf8"));
  if (!baseline.ok) {
    console.error(baseline.errors.join("\n"));
    return 2;
  }
  console.log(allowedEndpoints(groups, baseline.value.network).join("\n"));
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
