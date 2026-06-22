import { DecisionType } from "../../../../common/interfaces/types.js";
import type { PromptProfile } from "../../context-router.js";

export function buildIdentitySection(soul: unknown, user: unknown): string {
  return `You are an AI Agent.

Soul:
${JSON.stringify(soul, null, 2)}

User profile:
${JSON.stringify(user, null, 2)}`;
}

export function buildOutputContractSection(sessionId: string, profile: PromptProfile): string {
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

export function buildReasoningRulesSection(profile: PromptProfile): string {
  if (profile === "chat") {
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

export function buildActionGatesSection(profile: PromptProfile): string {
  if (profile === "chat") {
    return `
==================================================
ACTION GUIDANCE
==================================================

This is a conversational turn — respond directly when you have enough context.
If you discover you need external capabilities, call list_capabilities first.
Do not invent tools or skills.`.trim();
  }

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

export function buildEfficiencyPolicySection(profile: PromptProfile): string {
  if (profile === "chat") {
    return "";
  }

  const skillFirst =
    profile === "single_skill" || profile === "multi_skill" || profile === "planning"
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

export function buildMemoryPolicySection(sessionId: string): string {
  return `
==================================================
LONG TERM MEMORY POLICY
==================================================

Write memory ONLY when information will remain useful across future sessions.
Prefer UNDER-saving over OVER-saving.

STORE: stable user preferences, long-term goals, durable facts, explicit "remember this" requests.
DO NOT STORE: temporary requests, one-time tasks, conversation summaries, sensitive data, duplicates.

Confidence rule: HIGH → write | MEDIUM/LOW → skip.

Allowed memoryEntry.type values:
- "user_preference" — stable likes/dislikes
- "behavior_rule" — instructions affecting future behavior
- "fact" — durable user/project information

CORRECT: { "type": "memory_write", "memoryEntry": { "type": "user_preference", "content": "User prefers TypeScript over JavaScript", "sourceSessionId": "${sessionId}" } }`.trim();
}

export function buildActionPolicySection(
  sessionId: string,
  profile: PromptProfile,
  schemaEnforcement: string,
): string {
  if (profile === "chat") {
    return "";
  }

  const planningBlock =
    profile === "planning"
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

${schemaEnforcement}

ERROR RECOVERY:
- If last observation shows a validation/input error → retry with corrected fields per the inline schema.
- If last observation shows "not found" → call list_capabilities to verify available names.
- If last observation shows a transient failure → retry the same call once.
- If two consecutive retries fail on the same action → respond to the user explaining the blocker.

delegate_sub_agent:
- TOOL only — never a decision type
${planningBlock}

Agentic skill results:
- When a skill returns a finished artifact, deliver it to the user immediately.
- Do not re-invoke the same skill unless the user explicitly requests a revision.

Respond only when task is complete. Do not respond with "I am doing X" — respond with the result.`.trim();
}

export function buildFilesSection(sessionId: string, profile: PromptProfile): string {
  if (profile === "chat") {
    return "";
  }

  return `
==================================================
FILES
==================================================

Workspace paths are relative.

To show a generated image or file to the user, use this markdown format in your respond message:
![Image Description](${process.env.APP_BASE_URL}/workspace/sessions/${sessionId}/workspace/<relative-path>)
For non-image files, use a standard markdown link.`.trim();
}

export function buildPrimarySkillSection(skillName: string, promptMarkdown: string): string {
  return `
==================================================
PRIMARY SKILL — ${skillName}
==================================================

The router identified this skill as the best match for the user's request.
Prefer skill_call "${skillName}" over hand-rolling equivalent tool_calls.

${promptMarkdown}`.trim();
}
