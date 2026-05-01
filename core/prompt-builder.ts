import type { SkillRegistry, ToolRegistry } from "../common/interfaces/registry.js";
import type {
  LongTermMemoryEntry,
  SessionMemory,
} from "../common/interfaces/types.js";
import { formatInputSchemaForPrompt } from "../common/services/format-input-schema.js";
import type { Soul, User } from "../managers/profile-manager.js";

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
}

export interface BuiltPrompt {
  systemPrompt: string;
  userPrompt: string;
}

export class PromptBuilder {
  build(input: PromptBuilderInput): BuiltPrompt {
    const recentMessages =
      input.session.messages
        .slice(-20)
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n") || "none";

    if (!input.isBootstrapComplete) {
      return this.buildBootstrapPrompt(input, recentMessages);
    }

    return this.buildNormalPrompt(input, recentMessages);
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

  private buildNormalPrompt(
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
        .map((s) => {
          const head = `- ${s.name}${s.description ? `: ${s.description}` : ""}`;
          const schemaLines = formatInputSchemaForPrompt(s.inputSchema);
          return schemaLines ? `${head}\n${schemaLines}` : head;
        })
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
  "thought": "This task requires a multi-step workflow for document analysis. I will invoke the research_document skill.",
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
- The "type" field must be exactly one of: respond, tool_call, skill_call, memory_write, profile_write.
- Never put a tool or skill name directly in the "type" field.
- For file writing, use:
  {"thought": "...", "type": "tool_call", "tool": "write_file", "input": {"path": "workspace/test.txt", "content": "..."}}
- IMPORTANT: All files created or updated (PDFs, text files, etc.) MUST be stored within the 'workspace/' directory.
- Use "path", not "filename".
- Choose only ONE next action.
- When saving to profile_write, provide the FULL structured content object that matches the target schema.

Decision rules:
- Use tool_call for direct external actions (files, scheduling, Gmail, web search, PDF text extraction, time, memory search, etc.).
- Use skill_call only for workflows listed under Available skills (multi-step flows that compose tools and/or an internal LLM).
- Use memory_write only when useful long-term information should be saved.
- Use profile_write only when updating the user's profile or agent soul.
- Use respond only when the full task is complete.
- Do not ask the user unless required.
- If the previous action failed, use the "thought" field to analyze why and use "Last observation" to decide the next correction.
Available tools:
${tools}

Available skills:
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
