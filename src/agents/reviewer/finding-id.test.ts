import { describe, expect, it } from "vitest";
import { anchorOf, findingId } from "./finding-id.ts";

const FILE = "export function price(a: number) {\n  return a  *  2;\n}\n";

describe("finding identifiers", () => {
  it("anchors to the text of the line with the white space collapsed", () => {
    expect(anchorOf(FILE, 2)).toBe("return a * 2;");
    expect(anchorOf(FILE.replaceAll("\n", "\r\n"), 2)).toBe("return a * 2;");
  });

  it("anchors a finding on the whole file or a missing line to the file", () => {
    expect(anchorOf(FILE, 0)).toBe("");
    expect(anchorOf(FILE, 99)).toBe("");
    expect(anchorOf(undefined, 2)).toBe("");
  });

  it("keeps the identifier when the code moves or is reindented (FR-4.18)", () => {
    const moved = `// A comment.\n\n${FILE.replace("  return", "    return")}`;
    const before = findingId("kiss", "src/price.ts", anchorOf(FILE, 2));
    const after = findingId("kiss", "src/price.ts", anchorOf(moved, 4));
    expect(after).toBe(before);
    expect(before).toMatch(/^F-[0-9a-f]{12}$/);
  });

  it("gives another rule, file or line another identifier", () => {
    const id = findingId("kiss", "src/price.ts", "return a * 2;");
    expect(findingId("dry", "src/price.ts", "return a * 2;")).not.toBe(id);
    expect(findingId("kiss", "src/cart.ts", "return a * 2;")).not.toBe(id);
    expect(findingId("kiss", "src/price.ts", "return a * 3;")).not.toBe(id);
  });
});
