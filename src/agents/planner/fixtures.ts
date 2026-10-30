// Shared data for the Planner tests.
import type { Plan } from "./plan.ts";

export function aPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    summary: "Dodaje rabat do ceny koszyka.",
    approach: "Nowa funkcja w module cen, bez zmian w API.",
    acceptance: [
      { criterion: "Rabat 10% od 100 zł", how: "Funkcja discount i jej test" },
    ],
    files: [
      { path: "src/price.ts", change: "modify", why: "Dodaje discount." },
      { path: "src/price.test.ts", change: "modify", why: "Testuje rabat." },
    ],
    testing: "Vitest: nowe przypadki w price.test.ts.",
    estimatedChangedLines: 40,
    highImpact: { value: false, reasons: ["Jedna funkcja, bez zależności."] },
    ...overrides,
  };
}
