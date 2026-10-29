// Branches of a run are named `<type>/<issue>-<short-description>` (FR-4.7),
// so the issue of a branch, a pull request or a gates run follows from the
// branch name.
const RUN_BRANCH =
  /^(?:feat|fix|refactor|docs|chore)\/(\d+)-[a-z0-9][a-z0-9-]*$/;

export function issueOfBranch(ref: string): number | undefined {
  const match = RUN_BRANCH.exec(ref);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

// A new branch name for the stub Developer, different from every existing
// branch (FR-4.28b).
export async function newStubBranch(
  issue: number,
  exists: (name: string) => Promise<boolean>,
): Promise<string> {
  const base = `chore/${String(issue)}-stub-run`;
  for (let attempt = 1; ; attempt++) {
    const name = attempt === 1 ? base : `${base}-${String(attempt)}`;
    if (!(await exists(name))) return name;
  }
}
