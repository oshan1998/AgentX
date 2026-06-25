import { countInlineSchemaTools, formatCapabilitySchemaGuidance, formatMemorySection } from "./formatters.js";
import type { AgentRole, DynamicSectionContext, StaticSectionContext } from "./sections/types.js";
import type { DynamicPromptInput, StaticPromptInput } from "./types.js";

export function toStaticSectionContext(
  input: StaticPromptInput,
  agentRole: AgentRole,
): StaticSectionContext {
  const profile = input.promptProfile ?? "planning";
  const includeToolSchemas = profile !== "chat";
  const includeSkillSchemas = profile === "planning";

  let schemaEnforcement = "";
  if (agentRole === "principal" && profile !== "chat") {
    const inlineSchemaToolCount = includeToolSchemas
      ? countInlineSchemaTools(input.toolRegistry, true)
      : 0;
    schemaEnforcement =
      includeToolSchemas || includeSkillSchemas
        ? `SCHEMA POLICY:
  - For tool_call/skill_call, "input" MUST match the input schemas under Available tools / Available skills.
  - Do NOT guess or hallucinate field names — use the exact fields from the inline schema.

${formatCapabilitySchemaGuidance(inlineSchemaToolCount)}`
        : `SCHEMA POLICY:
  - Tool and skill names are listed without inline schemas.
  - Call get_capability_schema before every tool_call or skill_call.

${formatCapabilitySchemaGuidance(0)}`;
  }

  return {
    sessionId: input.sessionId,
    soul: input.soul,
    user: input.user,
    profile,
    agentRole,
    toolRegistry: input.toolRegistry,
    skillRegistry: input.skillRegistry,
    subAgentSystemPromptAppend: input.subAgentSystemPromptAppend,
    schemaEnforcement,
  };
}

export function toDynamicSectionContext(
  input: DynamicPromptInput,
  recentMessages: string,
  memory: string,
  contextLabel: string,
  goalLabel: string,
): DynamicSectionContext {
  return {
    latestUserMessage: input.latestUserMessage,
    iteration: input.iteration,
    maxIterations: input.maxIterations,
    lastObservation: input.lastObservation,
    recentMessages,
    memory,
    contextLabel,
    goalLabel,
  };
}

export function formatDynamicMemory(input: DynamicPromptInput): string {
  return formatMemorySection(input.relevantLongTermMemory);
}
