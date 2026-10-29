import { Lexer, type Token } from "./lexer.ts";

// Splits a shell command line into simple commands for the hook policies. This
// is a heuristic, not a shell: it reads quotes, escapes, operators,
// redirections and command substitutions, and it errs towards finding more
// commands. A script file that the agent runs is not read at all, so the
// runner sandbox is the second layer (SEC-9.0c).
export interface SimpleCommand {
  // Leading NAME=value words.
  assignments: string[];
  words: string[];
  // Files the command reads through input redirections.
  inputs: string[];
  // Files the command writes through output redirections.
  outputs: string[];
}

const MAX_DEPTH = 8;
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);
const EVAL = new Set(["eval"]);
// Here-documents and here-strings take text, and `>&2` duplicates a descriptor.
const TEXT_REDIRECTS = new Set(["<<", "<<-", "<<<"]);
const DUPLICATES = new Set([">&", "<&"]);

function basename(word: string): string {
  return word.slice(word.lastIndexOf("/") + 1);
}

// The words after every place where one of the programs runs in the command.
// Looking at every word, not just the first, also finds programs started
// through wrappers such as `sudo`, `env`, `xargs` or `find -exec`.
export function invocations(
  command: SimpleCommand,
  programs: ReadonlySet<string>,
): string[][] {
  return command.words.flatMap((word, index) =>
    programs.has(basename(word)) ? [command.words.slice(index + 1)] : [],
  );
}

export function commandText(command: SimpleCommand): string {
  return command.words.join(" ");
}

function isFileTarget(operator: string, target: string): boolean {
  if (TEXT_REDIRECTS.has(operator)) return false;
  return !(DUPLICATES.has(operator) && /^(\d+|-)$/.test(target));
}

// `<>` opens a file for both reading and writing.
function addRedirect(
  command: SimpleCommand,
  operator: string,
  target: string,
): void {
  if (!isFileTarget(operator, target)) return;
  if (operator.includes("<")) command.inputs.push(target);
  if (operator.includes(">")) command.outputs.push(target);
}

function emptyCommand(): SimpleCommand {
  return { assignments: [], words: [], inputs: [], outputs: [] };
}

function isEmpty(command: SimpleCommand): boolean {
  const { assignments, words, inputs, outputs } = command;
  return (
    assignments.length + words.length + inputs.length + outputs.length === 0
  );
}

function toCommands(tokens: readonly Token[]): SimpleCommand[] {
  const commands: SimpleCommand[] = [];
  let current = emptyCommand();
  let redirect: string | undefined;
  for (const token of tokens) {
    if (token.kind === "operator") {
      if (!isEmpty(current)) commands.push(current);
      current = emptyCommand();
    } else if (token.kind === "redirect") {
      redirect = token.operator;
    } else if (redirect !== undefined) {
      addRedirect(current, redirect, token.value);
      redirect = undefined;
    } else if (current.words.length === 0 && ASSIGNMENT.test(token.value)) {
      current.assignments.push(token.value);
    } else {
      current.words.push(token.value);
    }
  }
  if (!isEmpty(current)) commands.push(current);
  return commands;
}

// Scripts that a command runs from its arguments: `sh -c '...'` and `eval ...`.
function innerScripts(command: SimpleCommand): string[] {
  const shellScripts = invocations(command, SHELLS).flatMap((args) => {
    const flag = args.findIndex((arg) => /^-[a-z]*c[a-z]*$/i.test(arg));
    const script = flag === -1 ? undefined : args[flag + 1];
    return script === undefined ? [] : [script];
  });
  const evaluated = invocations(command, EVAL).map((args) => args.join(" "));
  return [...shellScripts, ...evaluated];
}

// Every simple command in the line, including the ones in command
// substitutions and in scripts passed to `sh -c` or `eval`.
export function parseShell(line: string, depth = 0): SimpleCommand[] {
  if (depth > MAX_DEPTH) {
    throw new Error(`Shell command nested deeper than ${String(MAX_DEPTH)}`);
  }
  const lexer = new Lexer(line).run();
  const commands = toCommands(lexer.tokens);
  const nested = [...lexer.substitutions, ...commands.flatMap(innerScripts)];
  return [
    ...commands,
    ...nested.flatMap((script) => parseShell(script, depth + 1)),
  ];
}
