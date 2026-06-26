export interface IterationContext {
  iteration: number;
  maxIterations: number;
}

export function iterationRules({ iteration, maxIterations }: IterationContext): string {
  return `\
==================================================
ITERATION RULES
==================================================

Current iteration: ${iteration} / ${maxIterations}

Iteration 1 — interpret intent, plan, take first action.

Iteration > 1 — PRIMARY: last observation. SECONDARY: original request (background context only).
- Advance ONE step from the last observation.
- Do not re-run the same skill/tool for the same deliverable unless the last observation shows failure.
- If a skill already returned a finished artifact (e.g. outputPath), respond to the user — do not generate another version.

Approaching max iterations — reduce exploration, prioritize convergence, finalize now.`;
}
