import type { PromptProfile } from "../../context-router.js";
import type { PromptSection, StaticSectionContext } from "./types.js";

function buildChatReasoningRules(): string {
  return `
==================================================
REASONING RULES
==================================================

"thought" is MANDATORY on every decision.

For iteration 1, your "thought" MUST include:
  • UNDERSTANDING — what the user actually wants
  • RESPONSE PLAN — how you will answer directly from context and memory
  • MEMORY CHECK — whether anything durable should be stored (only if clearly long-term)

For subsequent iterations:
  • STOP-CHECK — do you already have enough to respond?
  • CURRENT ACTION — what you are doing and why`.trim();
}

function buildPrincipalExecutionReasoningRules(profile: PromptProfile): string {
  const planningHint =
    profile === "planning"
      ? `  • ROUTING DECISION — MULTI-STEP: call plan_steps first, then orchestrate_task_graph`
      : `  • ROUTING DECISION:
      - MULTI-STEP → call plan_steps skill first, then orchestrate_task_graph
      - SHORT → execute directly — batch independent actions or call a matching workflow skill`;

  return `
==================================================
REASONING RULES
==================================================

"thought" is MANDATORY on every decision. Shallow thoughts are a failure mode.

For iteration 1, your "thought" MUST include:
  • UNDERSTANDING — what the user actually wants
  • TASK CLASSIFICATION — "MULTI-STEP" (6+ deliverables with dependencies, parallel research tracks,
    cross-artifact pipeline, or user asked to plan) or "SHORT" (≤5 tool calls, one deliverable, default)
${planningHint}
  • FIRST ACTION — exactly what you are emitting and why
  • ALTERNATIVES REJECTED — why not a different approach

For all subsequent iterations, your "thought" MUST include:
  • STOP-CHECK — "Do I already have enough to respond?" (YES → respond; NO → continue)
  • PLAN STATUS — which step you are on and what comes next
  • CURRENT ACTION — exactly what you are doing and why`.trim();
}

function buildSubAgentReasoningRules(): string {
  return `
==================================================
REASONING RULES
==================================================

"thought" is MANDATORY on every decision. Shallow thoughts are a failure mode.

For iteration 1, your "thought" MUST follow this structure:
"UNDERSTANDING: <what the principal actually wants>
FULL PLAN: (1) <step> → (2) <step> → ...
INDEPENDENT STEPS THIS TURN: <which first steps can run in parallel>
FIRST ACTION: <what you will do and why you are not splitting it>
ALTERNATIVES REJECTED: <why not approach X>"

For all subsequent iterations:
"STOP-CHECK: Do I have enough to respond? YES/NO
PLAN STATUS: <done steps> / <next step>
CURRENT ACTION: <what and why>"`.trim();
}

export const reasoningRulesSection: PromptSection<StaticSectionContext> = {
  id: "reasoning-rules",
  when: (ctx) => ctx.agentRole !== "bootstrap",
  build(ctx) {
    if (ctx.agentRole === "sub_agent") {
      return buildSubAgentReasoningRules();
    }
    if (ctx.profile === "chat") {
      return buildChatReasoningRules();
    }
    return buildPrincipalExecutionReasoningRules(ctx.profile);
  },
};
