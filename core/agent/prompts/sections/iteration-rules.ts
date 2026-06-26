export interface IterationContext {
  iteration: number;
  maxIterations: number;
}

function convergenceGate(iteration: number, maxIterations: number): string {
  const pct = iteration / maxIterations;

  if (pct >= 0.9) {
    return `\
⚠️  CRITICAL — ${iteration}/${maxIterations} iterations used (≥90%).
Respond NOW with whatever output you have. Do not call any more tools or skills.
An incomplete but delivered answer is better than exceeding the limit.`;
  }

  if (pct >= 0.7) {
    return `\
⚠️  CONVERGENCE REQUIRED — ${iteration}/${maxIterations} iterations used (≥70%).
Stop all exploration and research. Only execute the single remaining step that directly produces the final output.
If the output is already available (e.g. outputPath exists), respond immediately — do not generate another version.`;
  }

  return `Iteration ${iteration} / ${maxIterations} — budget healthy, proceed normally.`;
}

export function iterationRules({ iteration, maxIterations }: IterationContext): string {
  return `\
==================================================
ITERATION RULES
==================================================

${convergenceGate(iteration, maxIterations)}

Iteration 1 — interpret intent, plan, take first action.

Iteration > 1 — PRIMARY: last observation. SECONDARY: original request (background context only).
- Advance ONE step from the last observation.
- When multiple tools are independent (no ordering dependency), batch them in a single tool_call "tools" array — they run concurrently and save iterations.
- Do not re-run the same skill/tool for the same deliverable unless the last observation shows failure.
- If a skill already returned a finished artifact (e.g. outputPath), respond to the user — do not generate another version.`;
}
