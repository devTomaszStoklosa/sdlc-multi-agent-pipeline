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

// The decision in the audit log, so the session summary shows whether the
// hook ran and what it stopped (E1 of P6).
async function logDecision(
  event: { session_id: string },
  context: HookContext,
  dependencies: HookDependencies,
  failed: readonly Gate[],
): Promise<void> {
  const gates = STAGE_GATES[context.role];
  await dependencies.log.append({
    time: dependencies.now().toISOString(),
    session: event.session_id,
    role: context.role,
    tool: "Stop",
    input: gates.length === 0 ? "no gates" : gates.join(", "),
    decision: failed.length === 0 ? "allowed" : "denied",
    ...(failed.length === 0
      ? {}
      : {
          blocks: [
            {
              policy: "stage-gates",
              category: "quality",
              reason: `${failed.join(", ")} failed`,
            },
          ],
        }),
  });
}

// Refuses to let the agent finish while a gate of its stage fails, and sends
// the failures back to it (QG-9.12). The turn limit ends a session that never
// gets the gates to pass.
export async function handleStop(
  event: { session_id: string },
  context: HookContext,
  dependencies: HookDependencies,
): Promise<HookResponse> {
  const gates = STAGE_GATES[context.role];
  const failed: Gate[] = [];
  const failures: string[] = [];
  for (const gate of gates) {
    const found = await failedChecks(
      dependencies.runner,
      [[gate, context.commands[gate]]],
      [],
    );
    if (found.length > 0) failed.push(gate);
    failures.push(...found);
  }
  await logDecision(event, context, dependencies, failed);
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
