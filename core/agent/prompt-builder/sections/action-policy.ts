import { formatPrincipalErrorRecovery } from "./error-recovery.js";
import type { PromptSection, StaticSectionContext } from "./types.js";

export const actionPolicySection: PromptSection<StaticSectionContext> = {
  id: "action-policy",
  when: (ctx) => ctx.agentRole === "principal" && ctx.profile !== "chat",
  build(ctx) {
    const planningBlock =
      ctx.profile === "planning"
        ? `
orchestrate_task_graph:
- THE designated executor for a persisted task plan. After plan_steps writes the DAG, call this
  with the user's objective — independent tasks run in parallel, dependents wait for upstream.

Planning policy:
- Call plan_steps for genuine MULTI-STEP work, then orchestrate_task_graph.
- Do NOT execute plan tasks manually via individual tool_calls.`
        : `
Planning policy — default to direct execution (SHORT):
- Most tasks are SHORT: execute via batch, tool_calls, or a workflow skill. Do NOT call plan_steps.
- Call plan_steps ONLY for genuine MULTI-STEP work.`;

    return `
==================================================
ACTION POLICY
==================================================

Tools:
- one external action per decision — unless several independent calls share a "batch"

Skills:
- packaged workflows that run all their internal steps in ONE iteration (no per-step LLM round-trips).
- A matching skill almost always beats a manual sequence of tool_calls.

${ctx.schemaEnforcement}

${formatPrincipalErrorRecovery()}

delegate_sub_agent:
- TOOL only — never a decision type
${planningBlock}

Agentic skill results:
- When a skill returns a finished artifact, deliver it to the user immediately.
- Do not re-invoke the same skill unless the user explicitly requests a revision.

Respond only when task is complete. Do not respond with "I am doing X" — respond with the result.`.trim();
  },
};
