import type { HookContext } from "../context.ts";
import type { HookResponse } from "../events.ts";
import { redactText } from "../redact.ts";
import type { Role } from "../roles.ts";
import { failedChecks, type HookDependencies } from "./dependencies.ts";

type Gate = keyof HookContext["commands"];

// The gates that must pass before a role may finish its stage. The Planner and
// the Reviewer change no code, and the job validates their JSON result.
const STAGE_GATES: Readonly<Record<Role, readonly Gate[]>> = {
  planner: [],
  developer: ["lint", "test"],
  reviewer: [],
};

// Refuses to let the agent finish while a gate of its stage fails, and sends
// the failures back to it (QG-9.12). The turn limit ends a session that never
// gets the gates to pass.
export async function handleStop(
  context: HookContext,
  dependencies: HookDependencies,
): Promise<HookResponse> {
  const checks = STAGE_GATES[context.role].map(
    (gate) => [gate, context.commands[gate]] as const,
  );
  const failures = await failedChecks(dependencies.runner, checks, []);
  if (failures.length === 0) return { exitCode: 0 };
  const reason = [
    "Do not finish yet: the gates of this stage must pass first.",
    ...failures,
  ].join("\n\n");
  return {
    exitCode: 0,
    stdout: JSON.stringify({
      decision: "block",
      reason: redactText(reason).value,
    }),
  };
}
