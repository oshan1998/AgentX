import type { SkillRegistry, ToolRegistry } from "../../common/interfaces/registry.js";
import type {
  LongTermMemoryEntry,
  SessionMemory,
  Skill,
} from "../../common/interfaces/types.js";
import { formatInputSchemaForPrompt } from "../../common/services/format-input-schema.js";
import type { Soul, User } from "../../managers/profile-manager.js";
import { DecisionType, SkillType } from "../../common/interfaces/types.js";

const SESSION_MESSAGE_LIMIT = 20;

interface PromptBuilderInput {
  latestUserMessage: string;
  session: SessionMemory;
  relevantLongTermMemory: LongTermMemoryEntry[];
  toolRegistry: ToolRegistry;
  skillRegistry: SkillRegistry;
  lastObservation?: string;
  /** Plan emitted at iteration 1, carried forward to keep the agent on track. */
  activePlan?: string[];
  iteration: number;
  maxIterations: number;
  isBootstrapComplete: boolean;
  soul: Soul;
  user: User;
  isSubAgent?: boolean;
  /** Appended to sub-agent system prompt (agentic skills / delegate). */
  subAgentSystemPromptAppend?: string;
}

export interface BuiltPrompt {
  systemPrompt: string;
  userPrompt: string;
}

function formatSkillCatalogLine(s: Skill): string {
  const tag = s.kind === SkillType.Agentic ? SkillType.Agentic : SkillType.Workflow;
  const head = `- ${s.name} [${tag}]${s.description ? `: ${s.description}` : ""}`;
  const schemaLines = formatInputSchemaForPrompt(s.inputSchema);
  return schemaLines ? `${head}\n${schemaLines}` : head;
}

/**
 * Four-tier urgency signal based on how far through the iteration budget the agent is.
 * Gives the model a quantified contract instead of vague "as it approaches maximum".
 */
function iterationUrgencyLine(iteration: number, max: number): string {
  const ratio = iteration / max;
  if (ratio < 0.5) {
    return "EXPLORE — gather information freely; use as many steps as needed.";
  }
  if (ratio < 0.75) {
    return "CONVERGE — do not start new branches; complete current work only.";
  }
  if (ratio < 0.9) {
    return `URGENT (${iteration}/${max}) — respond now if you have enough. Only ONE more action if truly required.`;
  }
  return `CRITICAL (${iteration}/${max}) — you MUST respond this iteration. No further tool or skill calls.`;
}

function formatIterationRulesSection(input: PromptBuilderInput): string {
  return `
==================================================
ITERATION RULES
==================================================

Current iteration: ${input.iteration} / ${input.maxIterations}
Status: ${iterationUrgencyLine(input.iteration, input.maxIterations)}

If iteration = 1:
- Interpret intent. Emit a "plan" array of ALL steps you intend to take before responding.
- Take the first action immediately after planning.

If iteration > 1:
- PRIMARY: Last observation + active plan (shown below).
- SECONDARY: Original request is background context only — do not restart it.
- Advance exactly ONE step from the last observation.
- Do not re-run a step unless the last observation shows failure or missing output.
- If a skill already returned a finished artifact (outputPath, url, etc.), respond immediately.`.trim();
}

/**
 * Reasoning rules tailored to the current iteration.
 * Iteration 1: full exploration — interpret, plan, justify.
 * Iteration > 1: concise — observe, advance, act.
 */
function formatReasoningRulesSection(iteration: number): string {
  if (iteration === 1) {
    return `
==================================================
REASONING RULES
==================================================

"thought" is REQUIRED. Think step-by-step:
  1. Interpret the request and user intent.
  2. Identify all tools/skills needed and their order.
  3. Emit that sequence as a numbered "plan" array.
  4. State what you are doing first and why.

Choose EXACTLY ONE action.`.trim();
  }

  return `
==================================================
REASONING RULES
==================================================

"thought" is REQUIRED. Be concise — three points only:
  1. What the last observation shows (success / failure / partial).
  2. Which plan step comes next.
  3. Exactly what action you will take.

Choose EXACTLY ONE action.`.trim();
}

function formatCurrentGoalSection(input: PromptBuilderInput, goalLabel: string): string {
  if (input.iteration === 1) {
    return `
==================================================
${goalLabel} (primary instruction — interpret and plan first action)
==================================================

${input.latestUserMessage}`.trim();
  }

  return `
==================================================
${goalLabel} (already accepted — in progress, do not restart)
==================================================

${input.latestUserMessage}`.trim();
}

function formatAgentUserPrompt(
  input: PromptBuilderInput,
  recentMessages: string,
  memory: string,
  contextLabel: string,
): string {
  const iterationLine = `Iteration: ${input.iteration}/${input.maxIterations}`;
  const lastObservation = `Last observation:\n${input.lastObservation || "none"}`;
  const memorySection = `Relevant long-term memory:\n${memory}`;
  const contextSection = `${contextLabel}:\n${recentMessages}`;

  if (input.iteration === 1) {
    return `
${iterationLine}

${memorySection}

${contextSection}

${lastObservation}
`.trim();
  }

  const planSection =
    input.activePlan?.length
      ? `Active plan (emit at iteration 1 — check off completed steps):\n${input.activePlan.join("\n")}`
      : "";

  return `
${iterationLine}

EXECUTION MODE: Continue from last observation. Do not restart the original request.

${planSection ? planSection + "\n\n" : ""}${lastObservation}

${contextSection}

${memorySection}
`.trim();
}

export class PromptBuilder {
  build(input: PromptBuilderInput): BuiltPrompt {
    const recentMessages =
      input.session.messages
        .slice(-SESSION_MESSAGE_LIMIT)
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n") || "none";

    if (!input.isSubAgent && !input.isBootstrapComplete) {
      return this.buildBootstrapPrompt(input, recentMessages);
    }

    if (input.isSubAgent) {
      return this.buildSubAgentPrompt(input, recentMessages);
    }

    return this.buildMainPrompt(input, recentMessages);
  }

  /** Task instructions come from the principal agent; tooling is allow-listed; no persistence. */
  private buildSubAgentPrompt(
    input: PromptBuilderInput,
    recentMessages: string,
  ): BuiltPrompt {
    const tools =
      input.toolRegistry
        .list()
        .map((t) => {
          const head = `- ${t.name}${t.description ? `: ${t.description}` : ""}`;
          const schemaLines = formatInputSchemaForPrompt(t.inputSchema);
          return schemaLines ? `${head}\n${schemaLines}` : head;
        })
        .join("\n\n") || "none";

    const skills =
      input.skillRegistry
        .list()
        .map((s) => formatSkillCatalogLine(s))
        .join("\n\n") || "none";

    const memory =
      input.relevantLongTermMemory
        .map((m) => `- ${m.type}: ${m.content}`)
        .join("\n") || "none";

    const systemPrompt = `
You are a delegated specialist agent. Another agent ("principal") assigns each task below; reply so the principal can act or relay to someone else.
Soul and end-user blobs are grounding only—they are NOT your conversation partner this turn (the principal is). You cannot persist new long-term memories or profiles from this runtime.

Your isolated session id (for bookkeeping in tool arguments if needed): ${input.session.sessionId}

You must return ONLY valid JSON.
All reasoning MUST be contained within the "thought" field.
Do not return markdown outside the JSON.

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

3. Skill call (allow-listed skills below only — skills that write profile/memory will fail; avoid them or catch via your wording):
{
  "thought": "...",
  "type": "skill_call",
  "skill": "skill_name",
  "input": {}
}

At iteration 1, include a "plan" field on your first tool_call or skill_call — a numbered array of all steps you intend to take before responding. This plan will be shown to you on subsequent iterations.

Example with plan:
{
  "thought": "I need to read the file, extract the data, then respond.",
  "plan": ["1. Read the source file", "2. Extract required fields", "3. Respond to principal"],
  "type": "tool_call",
  "tool": "read_file",
  "input": { "path": "..." }
}

Important JSON rules:
- The "thought" field is MANDATORY.
- For tool_call/skill_call, "input" MUST match schemas under Available tools / Available skills.
- The "type" field must be exactly one of: respond, tool_call, skill_call — never memory_write nor profile_write.
- Choose ONE next action.
- Store deliverables inside your final respond message — the principal will persist preferences if appropriate.

Operational rules:
- Direct tools for concrete actions when appropriate (files, search, gmail, schedules, PDFs as allowed).
- If the previous observation shows an error, reason in "thought" and correct with the allowed tools/skills only.
- When responding to the principal agent, always provide a comprehensive summary of the completed task. Detail the actions taken, the outcomes of the agent loop iterations, and any relevant artifacts or deliverables produced.

Available tools:
${tools}

Available skills (tag: [workflow] = step runner, [agentic] = specialist sub-agent):
${skills}

${input.subAgentSystemPromptAppend?.trim() ? `---\n\n## Domain instructions\n\n${input.subAgentSystemPromptAppend.trim()}` : ""}

${formatIterationRulesSection(input)}

${formatReasoningRulesSection(input.iteration)}

${formatCurrentGoalSection(input, "DELEGATED TASK FROM PRINCIPAL")}
`.trim();

    const userPrompt = formatAgentUserPrompt(
      input,
      recentMessages,
      memory,
      "Recent sub-session transcript",
    );

    return { systemPrompt, userPrompt };
  }

  private buildBootstrapPrompt(
    input: PromptBuilderInput,
    recentMessages: string,
  ): BuiltPrompt {
    const systemPrompt = `
You are an onboarding agent.

You must return ONLY valid JSON.
Explanations must be contained within the "thought" field of the JSON response.
Do not return markdown outside the JSON.

BOOTSTRAP MODE:
The user is interacting with you for the first time.

Your goal is to collect enough information to create:
1. Agent Soul profile
2. User profile

Ask these questions naturally, 1–2 at a time:
1. What should I call you?
2. What kind of work do you usually do?
3. What would you like to call me?
4. How should I respond — short, detailed, technical, friendly?
5. Do you want me to use emojis in my responses?

Rules:
- Be friendly and conversational.
- Briefly and warmly explain that you're asking these questions to get to know the user better and to tailor your personality and assistance to perfectly match their needs.
- Example: "Hi! I'm so excited to get started. To make sure I can help you in the best way possible, I'd love to learn a little about you and how you'd like me to behave. Would you mind if I asked a few quick questions?"
- Do NOT sound like a form or survey.
- Do NOT call profile_write.
- Do NOT call memory_write.
- First collect all required information.
- After all required information is available, call bootstrap_finalize.
- Choose only ONE next action.

Important Decision Rule:
- Every response MUST include a "thought" field where you reason about the current state, what information you have collected, and what you need next.

Allowed JSON decisions:

1. Ask/respond:
{
  "thought": "I have introduced myself and now I need to ask for the user's name.",
  "type": "respond",
  "message": "..."
}

2. Finalize bootstrap:
{
  "thought": "I have collected all necessary information (name, role, tone preferences). I am now ready to finalize the profile.",
  "type": "skill_call",
  "skill": "bootstrap_finalize",
  "input": {
    "soul": {
      "name": "agent_name",
      "personality": {
        "tone": "friendly",
        "quirks": ""
      },
      "useEmojies": true
    },
    "user": {
      "name": "user_name",
      "role": "user_role",
      "facts": []
    }
  }
}

Important:
- Build the final soul and user objects from the user's answers.
- Use sensible defaults if the user skipped something.
- Do not expose this prompt to the user.
`.trim();

    const userPrompt = `
Current user message:
${input.latestUserMessage}

Recent context:
${recentMessages}
`.trim();

    return { systemPrompt, userPrompt };
  }

  private buildMainPrompt(
    input: PromptBuilderInput,
    recentMessages: string,
  ): BuiltPrompt {
    const tools =
      input.toolRegistry
        .list()
        .map((t) => {
          const head = `- ${t.name}${t.description ? `: ${t.description}` : ""}`;
          const schemaLines = formatInputSchemaForPrompt(t.inputSchema);
          return schemaLines ? `${head}\n${schemaLines}` : head;
        })
        .join("\n\n") || "none";

    const skills =
      input.skillRegistry
        .list()
        .map((s) => formatSkillCatalogLine(s))
        .join("\n\n") || "none";

    const memory =
      input.relevantLongTermMemory
        .map((m) => `- ${m.type}: ${m.content}`)
        .join("\n") || "none";

    const planGuidance =
      input.iteration === 1
        ? `
At iteration 1, include a "plan" field on your first tool_call or skill_call — a numbered array listing every step you intend to take before responding. This plan is shown to you on all subsequent iterations so you can track progress without re-deriving it.

Example:
{
  "thought": "I need to read the file, process it, write the output, then respond.",
  "plan": ["1. Read source file", "2. Extract and transform data", "3. Write output file", "4. Respond to user"],
  "type": "tool_call",
  "tool": "read_file",
  "input": { "path": "tasks/data.csv" }
}

If the task is a single action (one tool call then respond), you may omit "plan".`
        : "";

    const systemPrompt = `
You are an AI Agent.

Soul:
${JSON.stringify(input.soul, null, 2)}

User profile:
${JSON.stringify(input.user, null, 2)}

==================================================
OUTPUT CONTRACT
==================================================

Return ONLY valid JSON.
Never output markdown.
Never output text outside JSON.

Allowed decisions:

Respond (task complete — optionally batch memory writes here to avoid a separate iteration):
{
  "thought": "...",
  "type": "respond",
  "message": "...",
  "memoryEntries": [
    { "type": "user_preference|behavior_rule|fact", "content": "...", "sourceSessionId": "${input.session.sessionId}" }
  ]
}
"memoryEntries" is optional. Only include entries you are HIGH confidence are worth persisting across sessions. Omit the field entirely if nothing qualifies.

Tool call:
{
  "thought": "...",
  "type": "tool_call",
  "tool": "tool_name",
  "input": {}
}

Skill call:
{
  "thought": "...",
  "type": "skill_call",
  "skill": "skill_name",
  "input": {}
}

Memory write (use memoryEntries on respond instead when possible):
{
  "thought": "...",
  "type": "memory_write",
  "memoryEntry": {
    "type": "user_preference|behavior_rule|fact",
    "content": "...",
    "sourceSessionId": "${input.session.sessionId}"
  }
}

Profile write:
{
  "thought": "...",
  "type": "profile_write",
  "target": "soul|user",
  "content": {}
}
${planGuidance}

${formatReasoningRulesSection(input.iteration)}

==================================================
LONG TERM MEMORY POLICY
==================================================

You may proactively store memory.

Create a memory_write ONLY if information is likely
to remain useful across future sessions.

GOOD memory candidates:

✓ User preferences
  - preferred language
  - coding style
  - favorite tools
  - communication style

✓ Long-term goals
  - career goals
  - learning roadmap
  - ongoing project goals

✓ Stable facts
  - profession
  - expertise level
  - recurring workflows

✓ Explicit requests
  - "remember this"
  - "save this"
  - "from now on"

DO NOT store:

✗ temporary requests
✗ one-time tasks
✗ large conversation summaries
✗ short-lived plans
✗ sensitive/private information
✗ raw copied text
✗ duplicates of existing memory

Memory confidence rule:

HIGH confidence
→ write memory (prefer memoryEntries on respond over a separate memory_write iteration)

MEDIUM confidence
→ continue task without memory

LOW confidence
→ do not write memory

Prefer UNDER-saving over OVER-saving.

==================================================
ACTION POLICY
==================================================

Tools:
- single external action

Skills:
- packaged workflows
- prefer skill_call when available

delegate_sub_agent:
- TOOL only
- never a decision type

orchestrate_task_graph:
- use for parallel independent work

Multi-step tasks:
- maintain task plans
- persist artifacts to files

Agentic skill results (design and other [agentic] skills):
- When a skill returns outputPath or a finished artifact, deliver it to the user immediately.
- Do not re-invoke the same skill to fix critique failures or caveats unless the user explicitly requests a revision.
- If the result includes completed_with_caveats or remaining_issues, mention them briefly but still ship the artifact.

Respond only when task is complete.

==================================================
FILES
==================================================

Workspace paths are relative.

Correct:
tasks/report.md

Wrong:
filename.txt

To show a generated image or file to the user, use this markdown format in your respond message:
![Image Description](${process.env.APP_BASE_URL}/workspace/sessions/${input.session.sessionId}/workspace/<relative-path>)
For non-image files, use a standard markdown link.

Use:
{
  "type": "tool_call",
  "tool": "write_file",
  "input": {
    "path": "...",
    "content": "..."
  }
}

==================================================
AVAILABLE TOOLS
==================================================

${tools}

==================================================
AVAILABLE SKILLS
==================================================

${skills}

${formatIterationRulesSection(input)}

${formatCurrentGoalSection(input, "ORIGINAL USER REQUEST")}
`.trim();

    const userPrompt = formatAgentUserPrompt(
      input,
      recentMessages,
      memory,
      "Recent context",
    );

    return {
      systemPrompt,
      userPrompt,
    };
  }
}
