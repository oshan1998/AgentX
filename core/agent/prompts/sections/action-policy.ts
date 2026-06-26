export function actionPolicy(): string {
  return `\
==================================================
ACTION POLICY
==================================================

- Use tool_call for a single external action.
- Use skill_call when a packaged skill fits — prefer skills over raw tools.
- Use orchestrate_task_graph for parallel independent subtasks.
- For multi-step tasks: maintain a task plan and persist artifacts to files.

Agentic skill results:
- If the result includes outputPath or a finished artifact, deliver it to the user immediately.
- Do not re-invoke the same skill to address caveats unless the user requests a revision.
- If completed_with_caveats, mention briefly but still ship the artifact.

Respond only when the task is complete.`;
}
