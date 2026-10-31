// A stage that cannot start its session, such as a Developer stage whose
// install command fails. The job reports it as a failed stage without a
// session, instead of failing itself.
export class StageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StageError";
  }
}
