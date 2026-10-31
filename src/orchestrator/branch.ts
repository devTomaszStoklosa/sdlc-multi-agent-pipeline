// Branches of a run are named `<type>/<issue>-<short-description>` (FR-4.7),
// so the issue of a branch, a pull request or a gates run follows from the
// branch name.
const BRANCH_TYPES = ["feat", "fix", "refactor", "docs", "chore"] as const;
const RUN_BRANCH =
  /^(?:feat|fix|refactor|docs|chore)\/(\d+)-[a-z0-9][a-z0-9-]*$/;
const MAX_SLUG = 40;

export function issueOfBranch(ref: string): number | undefined {
  const match = RUN_BRANCH.exec(ref);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

// The branch type of a commit type; other Conventional Commits types, such as
// `test`, make a `chore` branch.
export function branchType(commitType: string): string {
  return (BRANCH_TYPES as readonly string[]).includes(commitType)
    ? commitType
    : "chore";
}

// The short description of a branch, from the issue title: ASCII letters and
// digits joined by hyphens. The title, not the model, names the branch.
export function slugOf(title: string): string {
  const ascii = title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replaceAll("ł", "l")
    .replaceAll("Ł", "L")
    .toLowerCase();
  const slug = ascii
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, MAX_SLUG)
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "change" : slug;
}

// A new branch name for a run, different from every existing branch
// (FR-4.7, FR-4.28b).
export async function newRunBranch(
  given: { type: string; issue: number; title: string },
  exists: (name: string) => Promise<boolean>,
): Promise<string> {
  const base = `${branchType(given.type)}/${String(given.issue)}-${slugOf(given.title)}`;
  for (let attempt = 1; ; attempt++) {
    const name = attempt === 1 ? base : `${base}-${String(attempt)}`;
    if (!(await exists(name))) return name;
  }
}
