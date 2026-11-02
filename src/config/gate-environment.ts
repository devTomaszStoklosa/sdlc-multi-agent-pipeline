import type { OrgBaseline } from "./schema.ts";

// The thresholds that only the repository's own tools can apply, such as the
// complexity rule of its linter (QG-7.1, QG-7.7). The lint and test commands
// get them as environment variables, in the gates workflow and in the hooks of
// an agent session alike, so both check a change the same way (QG-7.12).
export function gateEnvironment(
  gates: OrgBaseline["gates"],
): Record<string, string> {
  return {
    SDLC_STATIC_ANALYSIS_FAIL_ON: gates.static_analysis_fail_on,
    SDLC_MAX_FUNCTION_COMPLEXITY: String(gates.max_function_complexity),
  };
}
