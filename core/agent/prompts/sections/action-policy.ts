export function actionPolicy(): string {
  return `\
==================================================
ACTION POLICY
==================================================

Decision type selection:
- Use tool_call for a single external action.
- Use skill_call when a packaged skill fits — prefer skills over raw tools.
- For parallel or multi-step work, see PARALLELISM POLICY.

Agentic skill results:
- If the result includes outputPath or a finished artifact, deliver it to the user immediately.
- Do not re-invoke the same skill to address caveats unless the user requests a revision.
- If completed_with_caveats, mention briefly but still ship the artifact.

Stopping rule:
- Respond as soon as you have sufficient evidence to answer with confidence.
- You do NOT need to eliminate every alternative or reach absolute certainty. Stop when further searching is unlikely to change the answer.
- "I should double-check / make sure there isn't another X" is NOT a reason to continue unless the current evidence is actually ambiguous or contradictory.`;
}
