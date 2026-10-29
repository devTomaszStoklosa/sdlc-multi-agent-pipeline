import { describe, expect, it } from "vitest";
import { REDACTED, redactText, redactValue, withhold } from "./redact.ts";

// Built at run time, so the secret scanners do not flag the test file.
const TOKEN = ["sk", "ant", "oat01", "Abc123_def-456ghi789jkl"].join("-");
const GITHUB_TOKEN = `ghp_${"a1B2".repeat(9)}`;
const keyLine = (edge: string) =>
  ["-----" + edge, "OPENSSH", "PRIVATE", "KEY-----"].join(" ");
const PRIVATE_KEY = [
  keyLine("BEGIN"),
  "b3BlbnNzaC1rZXktdjEAAAAA",
  keyLine("END"),
].join("\n");

const base64 = (text: string) => Buffer.from(text).toString("base64");

describe("redactText", () => {
  it.each([
    ["a Claude token", `token=${TOKEN}`],
    ["a GitHub token", `Authorization: token ${GITHUB_TOKEN}`],
    ["a private key", `key:\n${PRIVATE_KEY}\nrest`],
    ["a cut-off private key", PRIVATE_KEY.split("\n").slice(0, 2).join("\n")],
    ["a token in base64", base64(`x=${TOKEN}`)],
    ["a token in base64 at every offset", base64(`ab${TOKEN}`)],
    ["a token in base64url", base64(`abc${TOKEN}`).replace(/\//g, "_")],
    ["a token in hex", Buffer.from(TOKEN).toString("hex")],
    [
      "a token in upper-case hex",
      Buffer.from(TOKEN).toString("hex").toUpperCase(),
    ],
  ])("removes %s", (_name, text) => {
    const result = redactText(text);
    expect(result.count).toBeGreaterThan(0);
    expect(result.value).toContain(REDACTED);
    expect(result.value).not.toContain(TOKEN);
    expect(result.value).not.toContain(GITHUB_TOKEN);
  });

  it.each([1, 2, 3])("removes a base64 token after %i bytes", (offset) => {
    const result = redactText(base64(`${"a".repeat(offset)}${TOKEN}`));
    expect(result.value).toBe(REDACTED);
  });

  it("leaves ordinary output alone", () => {
    const text = "PASS src/a.test.ts (3 tests)\nsk-ant is a prefix";
    expect(redactText(text)).toEqual({ value: text, count: 0 });
  });
});

describe("redactValue", () => {
  it("redacts every string and keeps the shape", () => {
    const output = {
      stdout: `TOKEN=${TOKEN}\n`,
      stderr: "",
      interrupted: false,
      lines: [TOKEN, "ok"],
    };
    expect(redactValue(output)).toEqual({
      value: {
        stdout: `TOKEN=${REDACTED}\n`,
        stderr: "",
        interrupted: false,
        lines: [REDACTED, "ok"],
      },
      count: 2,
    });
  });
});

describe("withhold", () => {
  it("replaces every string and keeps the shape", () => {
    expect(withhold({ stdout: "a", code: 1, list: ["b"] }, "-")).toEqual({
      stdout: "-",
      code: 1,
      list: ["-"],
    });
  });
});
