export type GoalLabel = "ORIGINAL USER REQUEST" | "DELEGATED TASK FROM PRINCIPAL";

export function currentGoal(message: string, label: GoalLabel, iteration: number): string {
  const status =
    iteration === 1
      ? "primary instruction — interpret and plan first action"
      : "already accepted — in progress, do not restart";

  return `\
==================================================
${label} (${status})
==================================================

${message}`;
}
