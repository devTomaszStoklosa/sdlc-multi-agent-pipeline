export type Token =
  | { kind: "word"; value: string }
  | { kind: "operator" }
  | { kind: "redirect"; operator: string };

// Longest operators first, so `&&` is not read as two `&`.
const OPERATORS = ["&&", "||", ";;", "|&", ";", "|", "&", "\n", "(", ")"];
const REDIRECTS = [
  "&>>",
  "<<<",
  "<<-",
  "&>",
  ">>",
  ">|",
  ">&",
  "<<",
  "<>",
  "<&",
  ">",
  "<",
];
const SUBSTITUTIONS = ["$(", "<(", ">("];
const DOUBLE_QUOTE_ESCAPES = new Set(["$", "`", '"', "\\", "\n"]);

// Reads a shell command line into words, operators and redirections. Quotes
// and escapes are removed from words. Command and process substitutions become
// a `$()` placeholder in the word, and their text is kept for a separate parse.
export class Lexer {
  readonly tokens: Token[] = [];
  readonly substitutions: string[] = [];
  private readonly text: string;
  private index = 0;
  private word: string | undefined;

  constructor(text: string) {
    this.text = text;
  }

  run(): this {
    while (this.index < this.text.length) this.step(this.at(this.index));
    this.endWord();
    return this;
  }

  private step(char: string): void {
    if (char === " " || char === "\t") {
      this.endWord();
      this.index += 1;
    } else if (char === "#" && this.word === undefined) this.comment();
    else if (
      !this.quoted(char) &&
      !this.substitution() &&
      !this.redirect() &&
      !this.operator()
    ) {
      this.append(char);
      this.index += 1;
    }
  }

  private quoted(char: string): boolean {
    if (char === "\\") this.escape();
    else if (char === "'") this.singleQuoted();
    else if (char === '"') this.doubleQuoted();
    else return false;
    return true;
  }

  private at(index: number): string {
    return this.text.charAt(index);
  }

  private append(text: string): void {
    this.word = (this.word ?? "") + text;
  }

  private endWord(): void {
    if (this.word !== undefined) {
      this.tokens.push({ kind: "word", value: this.word });
    }
    this.word = undefined;
  }

  // A backslash before a newline continues the line.
  private escape(): void {
    const next = this.at(this.index + 1);
    if (next !== "\n") this.append(next);
    this.index += 2;
  }

  private comment(): void {
    const end = this.text.indexOf("\n", this.index);
    this.index = end === -1 ? this.text.length : end;
  }

  private singleQuoted(): void {
    const end = this.closing("'", this.index + 1);
    this.append(this.text.slice(this.index + 1, end));
    this.index = end + 1;
  }

  private doubleQuoted(): void {
    this.append("");
    this.index += 1;
    while (this.index < this.text.length && this.at(this.index) !== '"') {
      const char = this.at(this.index);
      const next = this.at(this.index + 1);
      if (char === "\\" && DOUBLE_QUOTE_ESCAPES.has(next)) {
        if (next !== "\n") this.append(next);
        this.index += 2;
      } else if (!this.substitution()) {
        this.append(char);
        this.index += 1;
      }
    }
    this.index += 1;
  }

  private substitution(): boolean {
    if (this.at(this.index) === "`") {
      const end = this.closing("`", this.index + 1);
      this.capture(this.index + 1, end);
      return true;
    }
    if (!SUBSTITUTIONS.some((start) => this.text.startsWith(start, this.index)))
      return false;
    this.capture(this.index + 2, this.balanced(this.index + 2));
    return true;
  }

  private capture(start: number, end: number): void {
    this.substitutions.push(this.text.slice(start, end));
    this.append("$()");
    this.index = end + 1;
  }

  // The index of the parenthesis that closes one opened before `start`.
  private balanced(start: number): number {
    let depth = 1;
    let quote: string | undefined;
    for (let index = start; index < this.text.length; index += 1) {
      const char = this.at(index);
      if (quote !== undefined) {
        if (char === quote) quote = undefined;
      } else if (char === "'" || char === '"') quote = char;
      else if (char === "(") depth += 1;
      else if (char === ")" && --depth === 0) return index;
    }
    return this.text.length;
  }

  private closing(quote: string, start: number): number {
    const end = this.text.indexOf(quote, start);
    return end === -1 ? this.text.length : end;
  }

  private redirect(): boolean {
    const operator = REDIRECTS.find((candidate) =>
      this.text.startsWith(candidate, this.index),
    );
    if (operator === undefined) return false;
    // A file descriptor number belongs to the operator, as in `2>`.
    if (this.word !== undefined && /^\d+$/.test(this.word)) {
      this.word = undefined;
    }
    this.endWord();
    this.tokens.push({ kind: "redirect", operator });
    this.index += operator.length;
    return true;
  }

  private operator(): boolean {
    const operator = OPERATORS.find((candidate) =>
      this.text.startsWith(candidate, this.index),
    );
    if (operator === undefined) return false;
    this.endWord();
    this.tokens.push({ kind: "operator" });
    this.index += operator.length;
    return true;
  }
}
