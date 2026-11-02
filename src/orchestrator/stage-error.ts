import type { RoleOutcome } from "./role-output.ts";

type StageFailure = "infra" | "missing-update-lockfile";

// A stage that cannot start its session, such as a Developer stage whose
// install command fails. The job reports it as a failed stage without a
// session, instead of failing itself. A cause other than infrastructure gets
// its own escalation text (#58).
export class StageError extends Error {
  readonly failure: StageFailure;

  constructor(message: string, failure: StageFailure = "infra") {
    super(message);
    this.name = "StageError";
    this.failure = failure;
  }

  outcome(): RoleOutcome {
    return { kind: "failed", failure: this.failure, message: this.message };
  }
}
