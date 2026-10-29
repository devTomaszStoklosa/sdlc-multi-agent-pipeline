// Removes secrets from tool output before the model or a log sees it
// (SEC-9.10, NFR-9.11, plan 4).
export interface Redacted<T> {
  value: T;
  count: number;
}

export const REDACTED = "[REDACTED]";

// Secret shapes that tool output may contain.
const SECRET_PATTERNS = [
  // Anthropic API keys and Claude Code OAuth tokens.
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  // A private key, also when the output cuts it off before its end line.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
];

// Prefixes of those secrets, found again in base64 and hex dumps.
const ENCODED_PREFIXES = ["sk-ant-", "github_pat_", "-----BEGIN "];
// Shorter base64 fragments would match by chance in long encoded data.
const MIN_FRAGMENT = 6;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The base64 characters that encode only the prefix, for each of the three
// positions the prefix can take within a 3-byte group.
function base64Fragments(prefix: string): string[] {
  return [0, 1, 2].map((shift) => {
    const encoded = Buffer.from("\0".repeat(shift) + prefix).toString("base64");
    const start = Math.ceil((4 * shift) / 3);
    const end = Math.floor((4 * (shift + prefix.length)) / 3);
    return encoded.slice(start, end);
  });
}

function encodedPatterns(prefix: string): RegExp[] {
  const fragments = base64Fragments(prefix)
    .flatMap((fragment) => [
      fragment,
      fragment.replace(/\+/g, "-").replace(/\//g, "_"),
    ])
    .filter((fragment) => fragment.length >= MIN_FRAGMENT);
  const base64 = [...new Set(fragments)].map(
    (fragment) =>
      new RegExp(`[A-Za-z0-9+/_-]*${escape(fragment)}[A-Za-z0-9+/_=-]*`, "g"),
  );
  const hex = Buffer.from(prefix).toString("hex");
  return [...base64, new RegExp(`[0-9a-f]*${hex}[0-9a-f]*`, "gi")];
}

const PATTERNS = [
  ...SECRET_PATTERNS,
  ...ENCODED_PREFIXES.flatMap(encodedPatterns),
];

export function redactText(text: string): Redacted<string> {
  let count = 0;
  const value = PATTERNS.reduce(
    (current, pattern) =>
      current.replace(pattern, () => {
        count += 1;
        return REDACTED;
      }),
    text,
  );
  return { value, count };
}

// Redacts every string in a tool result and keeps its shape, so Claude Code
// still accepts it as the tool's output.
export function redactValue(value: unknown): Redacted<unknown> {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) {
    const items = value.map(redactValue);
    return {
      value: items.map((item) => item.value),
      count: items.reduce((sum, item) => sum + item.count, 0),
    };
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).map(
      ([key, item]) => [key, redactValue(item)] as const,
    );
    return {
      value: Object.fromEntries(
        entries.map(([key, item]) => [key, item.value]),
      ),
      count: entries.reduce((sum, [, item]) => sum + item.count, 0),
    };
  }
  return { value, count: 0 };
}

// Replaces every string in a tool result, for a hook that cannot redact it.
export function withhold(value: unknown, note: string): unknown {
  if (typeof value === "string") return note;
  if (Array.isArray(value)) return value.map((item) => withhold(item, note));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, withhold(item, note)]),
    );
  }
  return value;
}
