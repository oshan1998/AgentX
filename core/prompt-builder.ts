import type { SkillRegistry, ToolRegistry } from "../interfaces/registry.js";
import type {
  LongTermMemoryEntry,
  SessionMemory,
} from "../interfaces/types.js";
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

export class PromptBuilder {
  build(input: PromptBuilderInput): string {
    const recentMessages = input.session.messages.filter((m) => m.role !== "tool")
      .slice(-20)
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    const tools = input.toolRegistry
      .list()
      .map((t) => `- ${t.name}${t.description ? `: ${t.description}` : ""}`)
      .join("\n");

    const skills = input.skillRegistry
      .list()
      .map((s) => `- ${s.name}${s.description ? `: ${s.description}` : ""}`)
      .join("\n");

    const memory =
      input.relevantLongTermMemory
        .map((m) => `- ${m.type}: ${m.content}`)
        .join("\n") || "none";

    const bootstrapDirective = input.isBootstrapComplete ? "" : `
[SYSTEM DIRECTIVE: BOOTSTRAP MODE]
The user is interacting with you for the first time. Your immediate priority is to conduct a friendly onboarding conversation. 
Important:
- Ask questions in a friendly, conversational tone.
- Do NOT sound like a form or survey.
- Ask only 1–2 questions at a time.
- Make the user feel comfortable.

1. What should I call you?
2. What kind of work do you usually do?
3. What would you like to call me?
4. How should I respond — short, detailed, technical, friendly?
5. Do you want me to use emojis in my responses?

    
As the user answers these questions, use {"type":"profile_write"} to build the highly structured "soul" and "user" profiles based on their responses.
Profile write:
  for soul
    {"type":"profile_write","target":"soul","content":${JSON.stringify(input.soul, null, 2)}}
  for user
    {"type":"profile_write","target":"user","content":${JSON.stringify(input.user, null, 2)}}
Once you have collected enough information to satisfy these questions, use {"type":"memory_write"} to save {"type": "fact", "content": "bootstrap_complete", "sourceSessionId": "${input.session.sessionId}"}.
`;

    return `
You are an AI Agent with the following Soul parameters:
${JSON.stringify(input.soul, null, 2)}

You are interacting with a User whose profile is:
${JSON.stringify(input.user, null, 2)}

${bootstrapDirective}
You must return ONLY valid JSON.
Do not return markdown.
Do not explain.
Do not add extra text.

Allowed JSON decisions:

1. Respond:
{"type":"respond","message":"..."}

2. Tool call:
{"type":"tool_call","tool":"tool_name","input":{}}

3. Skill call:
{"type":"skill_call","skill":"skill_name","input":{}}

4. Memory write:
{"type":"memory_write","memoryEntry":{"type":"user_preference|behavior_rule|fact","content":"...","sourceSessionId":"${input.session.sessionId}"}}

5. Profile write:
  for soul
    {"type":"profile_write","target":"soul","content":${JSON.stringify(input.soul, null, 2)}}
  for user
    {"type":"profile_write","target":"user","content":${JSON.stringify(input.user, null, 2)}}
Important JSON rules:
- The "type" field must be exactly one of: respond, tool_call, skill_call, memory_write, profile_write.
- Never put a tool or skill name directly in the "type" field. (e.g. {"type": "web_search"} is strictly FORBIDDEN. Use {"type": "skill_call", "skill": "web_search"}).
- For file writing, use:
  {"type":"tool_call","tool":"write_file","input":{"path":"test.txt","content":"..."}}
- Use "path", not "filename".
- Choose only ONE next action.
- When saving to profile_write, provide the FULL structured {"content": {...}} object that matches the target schema.

Decision rules:
- Use tool_call for direct external actions.
- Use skill_call only for reusable workflows.
- Use respond only when the full task is complete.
- Do not ask the user unless required.
- If the previous action failed, use Last observation to decide the next correction.

Current task:
${input.latestUserMessage}

Iteration:
${input.iteration}/${input.maxIterations}

Relevant memory:
${memory}

Available tools:
${tools || "none"}

Available skills:
${skills || "none"}

Recent context:
${recentMessages || "none"}

Last observation:
${input.lastObservation || "none"}
`.trim();
  }
}
