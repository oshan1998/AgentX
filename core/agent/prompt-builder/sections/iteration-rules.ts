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
  → Interpret user intent and state the FULL plan in "thought" (every step you foresee).
  → Then immediately execute as much as is safe: prefer a single "batch" of all
    independent first actions, or a workflow skill that covers the whole task.
  → Do NOT take one trivial action when a batch or skill could cover more.

IF iteration > 1 AND last observation shows SUCCESS:
  → Advance to the next step(s). Batch any that are now independent. Do NOT restart
    or reinterpret the original request.

IF iteration > 1 AND last observation shows ERROR:
  → Diagnose in "thought". Fix input or try an alternative. Do NOT repeat the identical failing call.

IF iteration > 1 AND a skill already returned a finished artifact (e.g. outputPath):
  → Deliver the artifact to the user via respond. Do NOT regenerate it.

IF iteration >= ${input.maxIterations} - 1:
  → STOP exploring. Finalize immediately with best available result.
  → If task is incomplete, respond with partial result and explain what remains.

General rules:
- Do as much as you safely can THIS iteration. When several actions are independent
  (none needs another's output), emit ONE "batch" instead of spreading them across iterations.
- Only split work across iterations when the next action genuinely depends on this
  action's observation. Iterations are expensive — minimize them.
- The moment you have everything needed to satisfy the request, respond. Do NOT add
  verification iterations unless an observation showed an error.
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
