import type { PromptSection, StaticSectionContext } from "./types.js";

function buildChatActionGuidance(): string {
  return `
==================================================
ACTION GUIDANCE
==================================================

This is a conversational turn — respond directly when you have enough context.
If you discover you need external capabilities, call list_capabilities first.
Do not invent tools or skills.`.trim();
}

function buildPrincipalPreActionGate(): string {
  return `
==================================================
MANDATORY PRE-ACTION GATE
==================================================

Before choosing ANY action, answer these two questions in "thought":

1. STOP-CHECK: "Do I already have sufficient information to respond to the user?"
   → YES → you MUST emit "respond" right now. Do NOT explore further.
   → NO → continue.

2. BATCH-CHECK: "Are there 2 or more independent actions I will need?"
   → YES → you MUST emit a single "batch". Emitting a single tool_call instead is a VIOLATION.
   → NO → proceed with the single required action.

Skipping either gate is a prompt contract violation.`.trim();
}

function buildSubAgentPreActionGate(): string {
  return `
==================================================
MANDATORY PRE-ACTION GATE
==================================================

Before choosing ANY action, answer in "thought":

1. STOP-CHECK: "Do I already have sufficient information to complete the delegated task?"
   → YES → emit "respond" immediately with a comprehensive summary.
   → NO → continue.

2. BATCH-CHECK: "Are there 2 or more independent actions I will need?"
   → YES → emit ONE "batch". A single tool_call when a batch was possible = wasted iteration.
   → NO → proceed with the single required action.`.trim();
}

export const actionGatesSection: PromptSection<StaticSectionContext> = {
  id: "action-gates",
  when: (ctx) => ctx.agentRole !== "bootstrap",
  build(ctx) {
    if (ctx.agentRole === "sub_agent") {
      return buildSubAgentPreActionGate();
    }
    if (ctx.profile === "chat") {
      return buildChatActionGuidance();
    }
    return buildPrincipalPreActionGate();
  },
};
