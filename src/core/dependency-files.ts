// Files of package managers, as globs. A manifest lists the dependencies, a
// lockfile pins them. The high-impact rules treat both as a dependency change
// (FR-6.1); the scope gate allows a lockfile outside the plan only next to a
// planned manifest (QG-7.9).

export const DEPENDENCY_MANIFESTS = [
  "**/package.json",
  "**/requirements*.txt",
  "**/pyproject.toml",
  "**/Pipfile",
  "**/go.mod",
  "**/Cargo.toml",
  "**/Gemfile",
  "**/composer.json",
  "**/pom.xml",
  "**/build.gradle",
  "**/build.gradle.kts",
  "**/*.csproj",
  "**/packages.config",
  "**/Directory.Packages.props",
];

export const LOCKFILES = [
  "**/package-lock.json",
  "**/npm-shrinkwrap.json",
  "**/yarn.lock",
  "**/pnpm-lock.yaml",
  "**/poetry.lock",
  "**/Pipfile.lock",
  "**/go.sum",
  "**/Cargo.lock",
  "**/Gemfile.lock",
  "**/composer.lock",
];
