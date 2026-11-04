// The files that the CodeQL extractor of a language analyses, by path. CodeQL
// fails on a commit without any of them (#74), so the sast-base job skips a
// language that the base commit has no files of.
const LANGUAGE_FILES: Readonly<Record<string, RegExp>> = {
  actions: /^\.github\/workflows\/[^/]+\.ya?ml$|(^|\/)action\.ya?ml$/,
  "javascript-typescript": /\.(?:[cm]?[jt]s|[jt]sx)$/,
};

// The languages with at least one file among the paths. A language without
// an entry counts as present, so CodeQL runs on it as before and a missing
// entry can only make the gate fail, never skip an analysis.
export function languagesWithFiles(
  languages: readonly string[],
  paths: readonly string[],
): string[] {
  return languages.filter((language) => {
    const files = LANGUAGE_FILES[language];
    return files === undefined || paths.some((path) => files.test(path));
  });
}
