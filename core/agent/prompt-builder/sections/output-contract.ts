import { DecisionType } from "../../../../common/interfaces/types.js";
import type { PromptProfile } from "../../context-router.js";
import type { PromptSection, StaticSectionContext } from "./types.js";

function buildPrincipalOutputContract(sessionId: string, profile: PromptProfile): string {
  const chatDecisions =
    profile === "chat"
      ? `Respond
{
  "thought": "...",
  "type": "respond",
  "message": "..."
}

Tool call (meta tools only — list_capabilities, get_capability_schema, ask_user)
{
  "thought": "...",
  "type": "tool_call",
  "tool": "tool_name",
  "input": {}
}

Memory write
{
  "thought": "...",
  "type": "memory_write",
  "memoryEntry": {
    "type": "user_preference|behavior_rule|fact",
    "content": "...",
    "sourceSessionId": "${sessionId}"
  }
}

Profile write
{
  "thought": "...",
  "type": "profile_write",
  "target": "soul|user",
  "content": {}
}`
      : `Respond
{
  "thought": "...",
  "type": "respond",
  "message": "..."
}

Tool call
{
  "thought": "...",
  "type": "tool_call",
  "tool": "tool_name",
  "input": {}
}

Skill call
{
  "thought": "...",
  "type": "skill_call",
  "skill": "skill_name",
  "input": {}
}

Batch (parallel) — run independent tool_call/skill_call actions at once
{
  "thought": "...",
  "type": "batch",
  "actions": [
    { "type": "tool_call", "tool": "tool_a", "input": {} },
    { "type": "tool_call", "tool": "tool_b", "input": {} }
  ]
}

Memory write
{
  "thought": "...",
  "type": "memory_write",
  "memoryEntry": {
    "type": "user_preference|behavior_rule|fact",
    "content": "...",
    "sourceSessionId": "${sessionId}"
  }
}

Profile write
{
  "thought": "...",
  "type": "profile_write",
  "target": "soul|user",
  "content": {}
}`;

  const allowedDecisionTypes =
    profile === "chat"
      ? [
          DecisionType.Respond,
          DecisionType.ToolCall,
          DecisionType.MemoryWrite,
          DecisionType.ProfileWrite,
        ].join(" | ")
      : Object.values(DecisionType).join(" | ");

  return `
==================================================
OUTPUT CONTRACT
==================================================

Return ONLY valid JSON. Never output markdown. Never output text outside JSON.

Allowed decisions:

${chatDecisions}

"type" MUST be one of:
${allowedDecisionTypes}

Never place tool names in "type".`.trim();
}

function buildSubAgentOutputContract(): string {
  return `
==================================================
OUTPUT CONTRACT
==================================================

Allowed JSON decisions (ONLY):

1. Respond — final packaged result for the principal:
{
  "thought": "...",
  "type": "respond",
  "message": "Concise factual output the principal needs; include bullet facts here if persistence is advisable."
}

2. Tool call (allow-listed tools below only):
{
  "thought": "...",
  "type": "tool_call",
  "tool": "tool_name",
  "input": {}
}

3. Skill call (allow-listed skills below only — skills that write profile/memory will fail; avoid them):
{
  "thought": "...",
  "type": "skill_call",
  "skill": "skill_name",
  "input": {}
}

4. Batch (parallel tool/skill calls — PREFERRED for independent actions):
{
  "thought": "...",
  "type": "batch",
  "actions": [
    { "type": "tool_call", "tool": "tool_a", "input": {} },
    { "type": "tool_call", "tool": "tool_b", "input": {} }
  ]
}

"type" MUST be exactly one of: respond, tool_call, skill_call, batch — never memory_write nor profile_write.`.trim();
}

export const outputContractSection: PromptSection<StaticSectionContext> = {
  id: "output-contract",
  when: (ctx) => ctx.agentRole !== "bootstrap",
  build(ctx) {
    if (ctx.agentRole === "sub_agent") {
      return buildSubAgentOutputContract();
    }
    return buildPrincipalOutputContract(ctx.sessionId, ctx.profile);
  },
};
