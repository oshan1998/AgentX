import type { DynamicPromptInput } from "../types.js";

/** Iteration-specific urgency only — behavioral policy lives in the system prompt. */
export function formatIterationUrgencySection(
  input: Pick<DynamicPromptInput, "iteration" | "maxIterations">,
): string | null {
  if (input.iteration < input.maxIterations - 1) {
    return null;
  }

  return `URGENCY: You are on iteration ${input.iteration}/${input.maxIterations}. Finalize on this turn or the next — respond with the best available result and state anything incomplete.`;
}

export function formatCurrentGoalSection(
  input: Pick<DynamicPromptInput, "latestUserMessage">,
  goalLabel: string,
): string {
  return `
==================================================
${goalLabel}
==================================================

${input.latestUserMessage}`.trim();
}
