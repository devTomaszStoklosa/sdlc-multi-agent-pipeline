import { gateEnvironment } from "../../config/gate-environment.ts";
import type { EffectiveConfig } from "../../config/policy.ts";

// The commands and thresholds of the gates workflow, from the repository's
// configuration merged with the organization baseline (FR-10.2). An optional
// command that the repository leaves out is an empty string, which the gate
// reports as not configured.
export function gateOutputs(config: EffectiveConfig) {
  const { commands, gates } = config;
  return {
    install: commands.install,
    build: commands.build ?? "",
    test: commands.test,
    lint: commands.lint,
    format: commands.format,
    coverage: commands.coverage ?? "",
    sast_fail_on: gates.sast_fail_on,
    dependency_scan_fail_on: gates.dependency_scan_fail_on,
    coverage_drop_tolerance: String(gates.coverage_drop_tolerance),
    max_duplication_percent: String(gates.max_duplication_percent),
    environment: Object.entries(gateEnvironment(gates))
      .map(([name, value]) => `${name}=${value}`)
      .join("\n"),
  };
}

// The outputs in the multiline syntax of GITHUB_OUTPUT. A value with the
// delimiter could end its block early and set other outputs, so it is refused.
export function formatOutputs(
  outputs: Readonly<Record<string, string>>,
  delimiter: string,
): string {
  return Object.entries(outputs)
    .map(([name, value]) => {
      if (value.includes(delimiter)) {
        throw new Error(`The output ${name} contains the delimiter.`);
      }
      return `${name}<<${delimiter}\n${value}\n${delimiter}\n`;
    })
    .join("");
}
