// The CodeQL languages that the base commit of a pull request has files of,
// for the sast-base job of the gates workflow (QG-7.2, #74).
// Usage: sast-languages <languages-json> < paths
// The config job pipes in the paths of the base commit, separated by NUL as
// `git ls-tree -r -z --name-only` prints them, and the JSON array of the
// languages goes to the file in GITHUB_OUTPUT as `sast_base_languages`.
// Exit codes: 0 written, 2 usage or read error.
import { randomUUID } from "node:crypto";
import { appendFile } from "node:fs/promises";
import { text } from "node:stream/consumers";
import { z } from "zod";
import { formatOutputs } from "../config/outputs.ts";
import { languagesWithFiles } from "./languages.ts";

const languagesSchema = z.array(z.string());

async function main(args: readonly string[]): Promise<number> {
  const [languagesJson] = args;
  const outputPath = process.env.GITHUB_OUTPUT;
  if (languagesJson === undefined || args.length !== 1 || !outputPath) {
    console.error("Usage: sast-languages <languages-json> < paths");
    return 2;
  }
  try {
    const languages = languagesSchema.parse(JSON.parse(languagesJson));
    const paths = (await text(process.stdin))
      .split("\0")
      .filter((path) => path !== "");
    const present = languagesWithFiles(languages, paths);
    await appendFile(
      outputPath,
      formatOutputs(
        { sast_base_languages: JSON.stringify(present) },
        `EOF_${randomUUID()}`,
      ),
    );
    console.log(
      `CodeQL languages with files in the base commit: ${present.join(", ") || "none"}.`,
    );
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
}

process.exitCode = await main(process.argv.slice(2));
