import type { DeveloperWork } from "../agents/developer/work.ts";
import { redactText } from "../hooks/redact.ts";

// commitlint's default limits of a header and of a line of the body or the
// footer (QG-9.14).
const MAX_HEADER = 100;
const MAX_LINE = 100;

type Commit = DeveloperWork["commit"];

function subjectOf(subject: string): string {
  const trimmed = subject.trim().replace(/\.+$/, "");
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

// The pieces of a word, none longer than a line.
function pieces(word: string): string[] {
  const result: string[] = [];
  for (let start = 0; start < word.length; start += MAX_LINE) {
    result.push(word.slice(start, start + MAX_LINE));
  }
  return result;
}

// Breaks a line at spaces into lines within the limit; a word longer than a
// line, e.g. a URL, is cut.
function wrapLine(line: string): string[] {
  if (line.length <= MAX_LINE) return [line];
  const lines: string[] = [];
  let current = "";
  for (const piece of line.split(" ").filter(Boolean).flatMap(pieces)) {
    if (current !== "" && current.length + 1 + piece.length > MAX_LINE) {
      lines.push(current);
      current = "";
    }
    current = current === "" ? piece : `${current} ${piece}`;
  }
  return [...lines, current];
}

// The job commits the body as the session wrote it, so only the job can keep
// it within commitlint's line limit; the Developer cannot rewrite a pushed
// commit.
function wrapBody(body: string): string {
  return body.split("\n").flatMap(wrapLine).join("\n");
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
    : `${header}\n\n${wrapBody(redactText(body).value)}`;
}

// The merge of the main branch into the branch of an earlier run (FR-4.28b).
export function mergeMessage(
  main: string,
  branch: string,
  issue: number,
): string {
  return `chore: merge ${main} into ${branch} (#${String(issue)})`;
}
