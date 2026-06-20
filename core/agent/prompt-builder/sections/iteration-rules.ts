import type { DynamicPromptInput } from "../types.js";

export function formatIterationRulesSection(
  input: Pick<DynamicPromptInput, "iteration" | "maxIterations">,
): string {
  return `
==================================================
ITERATION RULES
==================================================

Current iteration: ${input.iteration} / ${input.maxIterations}

Decision tree:
IF iteration == 1:
  → Interpret user intent, plan approach, take first action.

IF iteration > 1 AND last observation shows SUCCESS:
  → Advance to the next planned step. Do NOT restart or reinterpret the original request.

IF iteration > 1 AND last observation shows ERROR:
  → Diagnose in "thought". Fix input or try an alternative. Do NOT repeat the identical failing call.

IF iteration > 1 AND a skill already returned a finished artifact (e.g. outputPath):
  → Deliver the artifact to the user via respond. Do NOT regenerate it.

IF iteration >= ${input.maxIterations} - 1:
  → STOP exploring. Finalize immediately with best available result.
  → If task is incomplete, respond with partial result and explain what remains.

General rules:
- Advance ONE step per iteration.
- Never re-run the same tool/skill for the same deliverable unless the previous attempt failed.
- The original user request is background intent after iteration 1 — do not treat it as a new task each time.`.trim();
}

export function formatCurrentGoalSection(
  input: Pick<DynamicPromptInput, "iteration" | "latestUserMessage">,
  goalLabel: string,
): string {
  if (input.iteration === 1) {
    return `
==================================================
${goalLabel} (primary instruction — interpret and plan first action)
==================================================

${input.latestUserMessage}`.trim();
  }

  return `
==================================================
${goalLabel} (already accepted — in progress, do not restart)
==================================================

${input.latestUserMessage}`.trim();
}
