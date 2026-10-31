import { randomBytes } from "node:crypto";

// One piece of untrusted data in a prompt: where it comes from and its text.
export type DataPiece = readonly [source: string, text: string];

export function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n[... truncated]`;
}

// A random value for the data tags, so the data cannot close its own tag.
export function newNonce(): string {
  return randomBytes(12).toString("hex");
}

// The untrusted data of a prompt, each piece in a tag that carries the nonce
// (SEC-8.5).
export function dataSection(
  pieces: readonly DataPiece[],
  nonce: string,
): string[] {
  const tag = `data-${nonce}`;
  return [
    `Untrusted data follows, each piece in a <${tag}> tag.`,
    ...pieces.map(
      ([source, text]) => `<${tag} source="${source}">\n${text}\n</${tag}>`,
    ),
  ];
}
