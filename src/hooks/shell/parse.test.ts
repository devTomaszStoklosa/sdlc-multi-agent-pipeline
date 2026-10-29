import { describe, expect, it } from "vitest";
import { invocations, parseShell, type SimpleCommand } from "./parse.ts";

function command(
  words: string[],
  extra: Partial<SimpleCommand> = {},
): SimpleCommand {
  return { assignments: [], words, inputs: [], outputs: [], ...extra };
}

describe("parseShell", () => {
  it.each([
    ["a single command", "npm test", [command(["npm", "test"])]],
    [
      "operators",
      "a && b || c; d | e & f\ng",
      ["a", "b", "c", "d", "e", "f", "g"].map((word) => command([word])),
    ],
    [
      "quotes and escapes",
      `echo 'a b' "c \\"d\\"" e\\ f`,
      [command(["echo", "a b", 'c "d"', "e f"])],
    ],
    ["an empty quoted word", "printf ''", [command(["printf", ""])]],
    ["a line continuation", "git \\\npush", [command(["git", "push"])]],
    ["a comment", "ls # rm -rf /", [command(["ls"])]],
    ["a hash inside a word", "echo a#b", [command(["echo", "a#b"])]],
    [
      "leading assignments",
      "HUSKY=0 LEFTHOOK=0 git commit",
      [command(["git", "commit"], { assignments: ["HUSKY=0", "LEFTHOOK=0"] })],
    ],
    [
      "an assignment after the program as a word",
      "make X=1",
      [command(["make", "X=1"])],
    ],
    [
      "redirections",
      "cat a > b 2>> c &>d <e <>f",
      [
        command(["cat", "a"], {
          inputs: ["e", "f"],
          outputs: ["b", "c", "d", "f"],
        }),
      ],
    ],
    [
      "a redirection without spaces",
      "echo hi>/tmp/x",
      [command(["echo", "hi"], { outputs: ["/tmp/x"] })],
    ],
    [
      "descriptor duplication and here-strings",
      "cmd 2>&1 >&2 <<< text <<EOF",
      [command(["cmd"])],
    ],
    [
      "a subshell",
      "(cd x && rm y)",
      [command(["cd", "x"]), command(["rm", "y"])],
    ],
  ])("reads %s", (_name, line, expected) => {
    expect(parseShell(line)).toEqual(expected);
  });

  it.each([
    ["a command substitution", "echo $(cat .env)"],
    ["a substitution in double quotes", 'echo "token: $(cat .env)"'],
    ["backticks", "echo `cat .env`"],
    ["a process substitution", "diff <(cat .env) b"],
    ["a nested substitution", "echo $(echo $(cat .env))"],
    ["sh -c", "sh -c 'cat .env'"],
    ["bash -lc through a wrapper", 'sudo /bin/bash -lc "cat .env"'],
    ["eval", "eval cat .env"],
  ])("finds the command in %s", (_name, line) => {
    expect(parseShell(line)).toContainEqual(command(["cat", ".env"]));
  });

  it("marks a substitution in a word", () => {
    expect(parseShell("rm -rf $(pwd)/..")[0]).toEqual(
      command(["rm", "-rf", "$()/.."]),
    );
  });

  it("does not read single-quoted text as a substitution", () => {
    expect(parseShell("echo '$(cat .env)'")).toEqual([
      command(["echo", "$(cat .env)"]),
    ]);
  });

  it("rejects commands nested too deeply", () => {
    const line = "eval ".repeat(10) + "ls";
    expect(() => parseShell(line)).toThrow("nested deeper");
  });
});

describe("invocations", () => {
  it("finds a program anywhere in the command, by its base name", () => {
    const [found] = parseShell("find . -exec /usr/bin/git push \\;");
    expect(invocations(found ?? command([]), new Set(["git"]))).toEqual([
      ["push", ";"],
    ]);
  });
});
