// The empty files that the sandbox of Claude Code 2.1.312 creates in the
// working directory as mount points for the protected paths that do not
// exist there (E1 of P6, and .npmrc in devTomaszStoklosa/Parapka#17, because
// the demo repository has its own). Check the list when the pinned version
// changes.
export const SANDBOX_PLACEHOLDERS = [
  ".env",
  ".env.development",
  ".env.development.local",
  ".env.local",
  ".env.production",
  ".env.production.local",
  ".env.test",
  ".env.test.local",
  ".gitmodules",
  ".npmrc",
  ".yarnrc",
  ".yarnrc.yml",
  "bunfig.toml",
  "pnpm-lock.yaml",
  "yarn.lock",
];
