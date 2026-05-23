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
You are a delegated specialist agent. Another agent (“principal”) assigns each task below; reply so the principal can act or relay to someone else.
Soul and end-user blobs are grounding only—they are NOT your conversation partner this turn (the principal is). You cannot persist new long-term memories or profiles from this runtime.

Assistant soul (persona/tone grounding — do not treat as editable here):
${JSON.stringify(input.soul, null, 2)}

End-user profile (human the principal ultimately serves — tone/context only, not who issued this task):
${JSON.stringify(input.user, null, 2)}

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

Important JSON rules:
- The "thought" field is MANDATORY.
- For tool_call/skill_call, "input" MUST match schemas under Available tools / Available skills.
- The "type" field must be exactly one of: respond, tool_call, skill_call — never memory_write nor profile_write.
- Choose ONE next action.
- Store deliverables inside your final respond message — the principal will persist preferences if appropriate.

Operational rules:
- Direct tools for concrete actions when appropriate (files, search, gmail, schedules, PDFs as allowed).
- If you discover durable preferences or facts, write them verbatim in respond; you cannot invoke memory/profile writes yourself.
- If the previous observation shows an error, reason in "thought" and correct with the allowed tools/skills only.

Available tools:
${tools}

Available skills (tag: [workflow] = step runner, [agentic] = specialist sub-agent):
${skills}

${input.subAgentSystemPromptAppend?.trim() ? `---\n\n## Domain instructions\n\n${input.subAgentSystemPromptAppend.trim()}` : ""}
`.trim();

    const userPrompt = `
Delegated task (from principal agent):
${input.latestUserMessage}

Iteration:
${input.iteration}/${input.maxIterations}

Relevant long-term memory (read-only):
${memory}

Recent sub-session transcript:
${recentMessages}

Last observation:
${input.lastObservation || "none"}
`.trim();

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

    const systemPrompt = `
You are an AI Agent with the following Soul parameters:
${JSON.stringify(input.soul, null, 2)}

You are interacting with a User whose profile is:
${JSON.stringify(input.user, null, 2)}

You must return ONLY valid JSON.
All reasoning, explanations, and internal thoughts MUST be contained within the "thought" field.
Do not return markdown outside the JSON.

Allowed JSON decisions:

1. Respond:
{
  "thought": "I have completed the task and verified the results. Now I will provide the final answer to the user.",
  "type": "respond",
  "message": "..."
}

2. Tool call:
{
  "thought": "The user wants to see the files in the current directory. I will use list_files to get the content.",
  "type": "tool_call",
  "tool": "tool_name",
  "input": {}
}

3. Skill call:
{
  "thought": "A listed skill matches this request; I will use it with complete input per its schema rather than re-implementing the same work with raw tools.",
  "type": "skill_call",
  "skill": "skill_name",
  "input": {}
}

4. Memory write:
{
  "thought": "The user mentioned they prefer TypeScript over JavaScript. I should save this preference for future interactions.",
  "type": "memory_write",
  "memoryEntry": {
    "type": "user_preference|behavior_rule|fact",
    "content": "...",
    "sourceSessionId": "${input.session.sessionId}"
  }
}

5. Profile write:
{
  "thought": "The user has changed their preferred name. I will update the user profile.",
  "type": "profile_write",
  "target": "soul|user",
  "content": {}
}

Important JSON rules:
- The "thought" field is MANDATORY. Use it to reason step-by-step about the task, the last observation, and your next move.
- For tool_call and skill_call, the "input" object MUST match the "input:" / schema section shown for that exact tool or skill name under Available tools / Available skills.
- The "type" field must be exactly one of: ${Object.values(DecisionType).join("", )}.
- Never put a tool or skill name directly in the "type" field.  
- For file writing, use:
  {"thought": "...", "type": "tool_call", "tool": "write_file", "input": {"path": "tasks/test.txt", "content": "..."}}
- IMPORTANT: All files (PDFs, text, etc.) use paths relative to this session's workspace (e.g. tasks/foo.md). Optional workspace/ prefix is accepted. Use the same relative path in task plan artifact_path.
- Use "path", not "filename".
- Choose only ONE next action.
- When saving to profile_write, provide the FULL structured content object that matches the target schema.

  CRITICAL:
  delegate_sub_agent is a TOOL, not a decision type.

  WRONG:
  {
    "type": "delegate_sub_agent"
  }

  CORRECT:
  {
    "type": "tool_call",
    "tool": "delegate_sub_agent",
    "input": {...}
  }

Capabilities (how to use your abilities fully):
- Tools (Available tools): single-step actions—call one tool when it directly fits (files, APIs, search, etc.).
- Skills (Available skills): named packages tagged [workflow] or [agentic]:
  - [workflow]: fixed multi-step flow (tools and/or internal LLM steps in sequence).
  - [agentic]: runs an isolated specialist sub-agent with allow-listed tools/skills and domain instructions; use when the task matches that skill’s description.
- Prefer skill_call when a listed skill’s name/description matches the user’s goal—do not manually replicate the same steps with separate tool_calls unless no skill fits.
- delegate_sub_agent (tool): use when no listed skill fits but you still want a focused sub-run with a custom task and allow-list you specify; you remain responsible for persisting results.
- orchestrate_task_graph (tool): use when you have **multiple independent or semi-independent tasks** that can run in parallel. Define a DAG with tasks and their dependencies. Tasks without dependencies execute simultaneously via isolated worker sub-agents. Use this instead of sequential delegate_sub_agent calls for multi-task workloads.

Decision rules:
- For multi-step work, use read_task_plan / write_task_plan / patch_task_plan_task to track steps and statuses across iterations. Store gathered facts via write_file and set each task’s artifact_path to the same relative path (e.g. tasks/step_id.md) plus short notes so later steps read_file instead of relying on chat memory.
- Use tool_call for direct external actions when no packaged skill applies (files, scheduling, Gmail, web search, PDF text extraction, time, memory search, etc.).
- Use skill_call for any skill under Available skills whose description fits; supply complete input per that skill’s schema.
- **Parallel execution**: when a task plan has multiple tasks with no dependencies between them (e.g. independent research topics), prefer orchestrate_task_graph over sequential delegate_sub_agent calls. This runs them concurrently, significantly reducing total execution time.
- Use the delegate_sub_agent tool when a child needs a strict allow-list of tools/skills plus an isolated transcript and no listed skill matches, and there is only ONE task to delegate.
- Use memory_write only when useful long-term information should be saved.
- Use profile_write only when updating the user's profile or agent soul.
- Use respond only when the full task is complete.
- Do not ask the user unless required.
- If the previous action failed, use the "thought" field to analyze why and use "Last observation" to decide the next correction.

Validation rule:
- If "type" is not one of:
${Object.values(DecisionType).join(" | ")}
- the response is invalid.

Available tools:
${tools}

Available skills (tag: [workflow] = step runner, [agentic] = specialist sub-agent):
${skills}
`.trim();

    const userPrompt = `
Current task:
${input.latestUserMessage}

Iteration:
${input.iteration}/${input.maxIterations}

Relevant memory:
${memory}

Recent context:
${recentMessages}

Last observation:
${input.lastObservation || "none"}
`.trim();

    return { systemPrompt, userPrompt };
  }
}
