// Shared data for the Developer tests.
import type { DeveloperBrief } from "./brief.ts";
import type { DeveloperWork } from "./work.ts";

export function aWork(overrides: Partial<DeveloperWork> = {}): DeveloperWork {
  return {
    commit: { type: "feat", subject: "add a discount to the cart price" },
    summary: "Dodaje rabat 10% od 100 zł.",
    outOfScope: [],
    ...overrides,
  };
}

export function aBrief(
  overrides: Partial<DeveloperBrief> = {},
): DeveloperBrief {
  return {
    kind: "developer",
    plan: {
      version: 1,
      body: "### Plan, wersja 1 (przebieg 12-1)",
      url: "https://github.test/issues/12#issuecomment-1",
    },
    gateFailures: [],
    conflicts: [],
    commands: { install: "npm ci", lint: "npm run lint", test: "npm test" },
    ...overrides,
  };
}
