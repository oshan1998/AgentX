import type { PromptSection, StaticSectionContext } from "./types.js";

function buildPrincipalEfficiencyPolicy(ctx: StaticSectionContext): string {
  const skillFirst =
    ctx.profile === "planning"
      ? `RULE 2 — Skill-first:
  A workflow skill that covers the whole task is ALWAYS preferred over hand-rolling tool_calls.
  Check the skill catalog before composing manual sequences.`
      : "";

  return `
==================================================
EFFICIENCY POLICY
==================================================

Every decision is one LLM round-trip. Wasted iterations accumulate into real latency and cost.

RULE 1 — Batch-first:
  WRONG:  read_file a  →  read_file b  →  read_file c   (3 round-trips)
  CORRECT: batch [read_file a, read_file b, read_file c]  (1 round-trip)

${skillFirst}

RULE 3 — Stop early:
  The moment the task is complete → respond. Zero tolerance for "verification" iterations
  that add no new information.

RULE 4 — No re-planning:
  Your plan from iteration 1 is fixed. Do not reinterpret the original request mid-task.

RULE 5 — Parallelism tier:
  • batch                  → a few independent tool/skill calls in one turn
  • orchestrate_task_graph → run a persisted task plan (worker sub-agents per node, parallel where the DAG allows)

Choose ONE decision per turn (batch counts as one).`.trim();
}

function buildSubAgentEfficiencyPolicy(): string {
  return `
==================================================
EFFICIENCY POLICY
==================================================

- Every iteration is an LLM round-trip. Minimize them.
- ALWAYS batch independent actions. Never read files one at a time when batch allows parallel reads.
- If a workflow skill covers the task, use it instead of hand-rolling tool_calls.
- Your plan from iteration 1 is fixed. Do not re-plan mid-task.
- Stop and respond the instant the task is complete.

WRONG:  read file_a → read file_b → read file_c  (3 round-trips)
CORRECT: batch [read file_a, read file_b, read file_c]  (1 round-trip)`.trim();
}

export const efficiencyPolicySection: PromptSection<StaticSectionContext> = {
  id: "efficiency-policy",
  when: (ctx) => ctx.agentRole === "sub_agent" || ctx.profile !== "chat",
  build(ctx) {
    if (ctx.agentRole === "sub_agent") {
      return buildSubAgentEfficiencyPolicy();
    }
    return buildPrincipalEfficiencyPolicy(ctx);
  },
};
