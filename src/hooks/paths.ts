import path from "node:path";

export interface WorkspacePath {
  absolute: string;
  // Relative to the workspace, or empty for the workspace itself.
  relative: string;
  inside: boolean;
}

// Stands in for the home directory, which the hooks never need to know: any
// path under it is outside the workspace.
const HOME = "/~";

// Glob patterns for workspace paths: `**` matches any number of directories, `*`
// any characters within one directory and `?` one character. Every other
// character is literal. Unlike shell globs, wildcards also match dotfiles,
// because a secret in a hidden directory is still a secret. Matching ignores
// case, which can only block more paths.
const GLOB_TOKENS = new Map([
  ["**/", "(?:.*/)?"],
  ["/**", "(?:/.*)?"],
  ["**", ".*"],
  ["*", "[^/]*"],
  ["?", "[^/]"],
]);

function globToRegExp(pattern: string): RegExp {
  const source = pattern
    .split(/(\*\*\/|\/\*\*$|\*\*|\*|\?)/)
    .map(
      (part) =>
        GLOB_TOKENS.get(part) ?? part.replace(/[.+^${}()|[\]\\]/g, "\\$&"),
    )
    .join("");
  return new RegExp(`^${source}$`, "i");
}

export function matchesGlob(
  target: string,
  patterns: readonly string[],
): boolean {
  return patterns.some((pattern) => globToRegExp(pattern).test(target));
}

// Resolves a path the way a tool or a shell started in the workspace would.
// Shell variables are not expanded, so a path with one is treated as outside.
export function resolvePath(workspace: string, target: string): WorkspacePath {
  const expanded = target.replace(/^~(?=\/|$)/, HOME).replace(/\\/g, "/");
  const absolute = expanded.includes("$")
    ? path.posix.join(HOME, expanded)
    : path.posix.resolve(workspace, expanded);
  const relative = path.posix.relative(workspace, absolute);
  const inside =
    relative === "" ||
    (!relative.startsWith("..") && !path.posix.isAbsolute(relative));
  return { absolute, relative, inside };
}

// The form that path patterns are matched against: relative inside the
// workspace, absolute without the leading slash outside it.
export function patternPath(target: WorkspacePath): string {
  return target.inside ? target.relative : target.absolute.slice(1);
}
