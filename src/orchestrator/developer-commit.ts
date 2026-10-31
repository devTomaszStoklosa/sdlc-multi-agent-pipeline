import type { DeveloperWork } from "../agents/developer/work.ts";
import { redactText } from "../hooks/redact.ts";

// commitlint's default limit of a header (QG-9.14).
const MAX_HEADER = 100;

type Commit = DeveloperWork["commit"];

function subjectOf(subject: string): string {
  const trimmed = subject.trim().replace(/\.+$/, "");
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

// The commit message of a Developer stage, built by the job from the
// session's facts: Conventional Commits with the issue in the header
// (FR-4.9). Commits are public, so secrets are redacted (SEC-9.10).
export function commitMessage(commit: Commit, issue: number): string {
  const prefix = `${commit.type}${commit.scope === undefined ? "" : `(${commit.scope})`}: `;
  const reference = ` (#${String(issue)})`;
  const room = MAX_HEADER - prefix.length - reference.length;
  const subject = redactText(subjectOf(commit.subject)).value.slice(0, room);
  const header = `${prefix}${subject.trimEnd()}${reference}`;
  const body = commit.body?.trim();
  return body === undefined || body === ""
    ? header
    : `${header}\n\n${redactText(body).value}`;
}

// The merge of the main branch into the branch of an earlier run (FR-4.28b).
export function mergeMessage(
  main: string,
  branch: string,
  issue: number,
): string {
  return `chore: merge ${main} into ${branch} (#${String(issue)})`;
}
