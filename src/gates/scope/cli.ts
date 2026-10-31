// The scope gate (QG-7.9) in the gates workflow of a connected repository.
// Usage: scope-gate. The event, the repository and the read-only workflow
// token come from the environment of GitHub Actions; SDLC_APP_ID names the
// pipeline's app. Exit codes: 0 passed or not applicable, 1 failed, 2 error.
import { appendFile, readFile } from "node:fs/promises";
import { createGitHub } from "../../github/client.ts";
import { passed, report, runScopeGate } from "./gate.ts";

function env(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`The environment variable ${name} is not set.`);
  }
  return value;
}

async function main(): Promise<number> {
  try {
    const repository = env("GITHUB_REPOSITORY");
    const appId = Number(env("SDLC_APP_ID"));
    const github = createGitHub({
      token: env("GITHUB_TOKEN"),
      repository,
      appId,
      baseUrl: process.env.GITHUB_API_URL,
    });
    const payload: unknown = JSON.parse(
      await readFile(env("GITHUB_EVENT_PATH"), "utf8"),
    );
    const result = await runScopeGate(
      {
        comments: github.comments,
        contents: github.contents,
        appId,
        repository,
      },
      { name: env("GITHUB_EVENT_NAME"), payload },
    );
    const text = report(result);
    console.log(text);
    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (summary) await appendFile(summary, `${text}\n`);
    return passed(result) ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
}

process.exitCode = await main();
