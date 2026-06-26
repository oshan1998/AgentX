export type GoalLabel = "ORIGINAL USER REQUEST" | "DELEGATED TASK FROM PRINCIPAL";

export function currentGoal(message: string, label: GoalLabel, iteration: number): string {
  if (iteration === 1) {
    return `\
==================================================
${label} (primary instruction — interpret and plan first action)
==================================================

${message}`;
  }

  // On later iterations, the original message is already in session history.
  // Repeating it here causes the LLM to re-plan instead of advancing from last observation.
  return `\
==================================================
${label} (already accepted — advance from last observation, do not restart)
==================================================`;
}
