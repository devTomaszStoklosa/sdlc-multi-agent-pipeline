import type { OrgBaseline } from "../../config/schema.ts";
import type { ChangedFile } from "../../github/ports.ts";
import { matchesGlob } from "../../hooks/paths.ts";
import type { Plan } from "./plan.ts";

// The run's high-impact section, merged with the baseline (FR-10.5).
export type HighImpactPolicy = OrgBaseline["high_impact"];

// What the deterministic rules look at: the files of the plan and of the
// branch it continues, and the changed lines of both.
export interface ChangeFacts {
  paths: readonly string[];
  changedLines: number;
}

// One criterion of FR-6.1 that code can check. It returns the reason, shown
// in the plan comment, when the change meets the criterion.
export interface HighImpactRule {
  check(facts: ChangeFacts, policy: HighImpactPolicy): string | undefined;
}

const DEPENDENCY_MANIFESTS = [
  "**/package.json",
  "**/package-lock.json",
  "**/npm-shrinkwrap.json",
  "**/yarn.lock",
  "**/pnpm-lock.yaml",
  "**/requirements*.txt",
  "**/pyproject.toml",
  "**/poetry.lock",
  "**/Pipfile",
  "**/Pipfile.lock",
  "**/go.mod",
  "**/go.sum",
  "**/Cargo.toml",
  "**/Cargo.lock",
  "**/Gemfile",
  "**/Gemfile.lock",
  "**/composer.json",
  "**/composer.lock",
  "**/pom.xml",
  "**/build.gradle",
  "**/build.gradle.kts",
  "**/*.csproj",
  "**/packages.config",
  "**/Directory.Packages.props",
];

// CI, infrastructure and the configuration of the gates, `.sdlc-agents.yml`
// included (FR-6.1, FR-10.3, QG-7.11).
const CI_AND_GATES = [
  ".github/**",
  ".sdlc-agents.yml",
  ".gitlab-ci.yml",
  ".circleci/**",
  "azure-pipelines.yml",
  "Jenkinsfile",
  "**/Dockerfile",
  "**/docker-compose*.yml",
  "**/*.tf",
  "infra/**",
  "lefthook.yml",
  ".lefthook.yml",
  "**/eslint.config.*",
  "**/.eslintrc*",
  "**/.prettierrc*",
  "**/prettier.config.*",
  "**/vitest.config.*",
  "**/jest.config.*",
  "**/tsconfig*.json",
  ".jscpd.json",
  "**/commitlint.config.*",
  ".gitleaks.toml",
  "CODEOWNERS",
];

function list(paths: readonly string[]): string {
  return paths.map((item) => `\`${item}\``).join(", ");
}

function pathRule(
  patterns: (policy: HighImpactPolicy) => readonly string[],
  reason: string,
): HighImpactRule {
  return {
    check(facts, policy) {
      const matched = facts.paths.filter((file) =>
        matchesGlob(file, patterns(policy)),
      );
      return matched.length > 0 ? `${reason}: ${list(matched)}` : undefined;
    },
  };
}

export const HIGH_IMPACT_RULES: readonly HighImpactRule[] = [
  pathRule(() => DEPENDENCY_MANIFESTS, "manifest albo lockfile zależności"),
  pathRule(
    () => CI_AND_GATES,
    "pliki CI, infrastruktury albo konfiguracji bramek",
  ),
  pathRule(
    (policy) => policy.extra_paths,
    "ścieżki z `high_impact.extra_paths`",
  ),
  {
    check: ({ paths }, { max_files }) =>
      paths.length > max_files
        ? `${String(paths.length)} plików, więcej niż limit ${String(max_files)} (\`high_impact.max_files\`)`
        : undefined,
  },
  {
    check: ({ changedLines }, { max_changed_lines }) =>
      changedLines > max_changed_lines
        ? `ok. ${String(changedLines)} zmienionych linii, więcej niż limit ${String(max_changed_lines)} (\`high_impact.max_changed_lines\`)`
        : undefined,
  },
];

// The plan's files and estimate, together with what the branch of an earlier
// run already changes (FR-4.28b).
export function changeFacts(
  plan: Plan,
  branchFiles: readonly ChangedFile[] = [],
): ChangeFacts {
  const paths = new Set(plan.files.map((file) => file.path));
  for (const file of branchFiles) paths.add(file.path);
  const branchLines = branchFiles.reduce(
    (sum, file) => sum + file.additions + file.deletions,
    0,
  );
  return {
    paths: [...paths],
    changedLines: plan.estimatedChangedLines + branchLines,
  };
}

export interface Reason {
  source: "rule" | "model";
  text: string;
}

export interface Classification {
  highImpact: boolean;
  reasons: Reason[];
}

// High-impact is the sum of the rules and the model's assessment, because a
// missed high-impact change costs more than a false alarm (spec 12.2). The
// assessment is the Planner's of a plan or the Developer's of its update.
export function classify(
  assessment: Plan["highImpact"],
  facts: ChangeFacts,
  policy: HighImpactPolicy,
  rules: readonly HighImpactRule[] = HIGH_IMPACT_RULES,
): Classification {
  const fromRules = rules
    .map((rule) => rule.check(facts, policy))
    .filter((reason) => reason !== undefined)
    .map((text): Reason => ({ source: "rule", text }));
  const fromModel = assessment.reasons.map((text): Reason => ({
    source: "model",
    text,
  }));
  return {
    highImpact: assessment.value || fromRules.length > 0,
    reasons: [...fromRules, ...fromModel],
  };
}
