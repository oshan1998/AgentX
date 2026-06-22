import {
  formatSkillCatalog,
  formatToolCatalog,
  formatCapabilitySchemaGuidance,
  countInlineSchemaTools,
} from "../formatters.js";
import { formatAgentUserPrompt } from "../sections/user-prompt.js";
import {
  buildActionGatesSection,
  buildActionPolicySection,
  buildEfficiencyPolicySection,
  buildFilesSection,
  buildIdentitySection,
  buildMemoryPolicySection,
  buildOutputContractSection,
  buildPrimarySkillSection,
  buildReasoningRulesSection,
} from "../sections/main-policy.js";
import type { DynamicPromptInput, PromptStrategy, StaticPromptInput } from "../types.js";

export class MainStrategy implements PromptStrategy {
  buildStatic(input: StaticPromptInput): string {
    const profile = input.promptProfile ?? "planning";
    const includeToolSchemas = profile !== "chat";
    const includeSkillSchemas = profile === "single_skill" || profile === "planning";

    const tools = formatToolCatalog(input.toolRegistry, includeToolSchemas);
    const skills =
      input.skillRegistry.list().length > 0
        ? formatSkillCatalog(input.skillRegistry, includeSkillSchemas)
        : "";

    const inlineSchemaToolCount = includeToolSchemas
      ? countInlineSchemaTools(input.toolRegistry, true)
      : 0;
    const schemaEnforcement =
      profile === "chat"
        ? ""
        : includeToolSchemas || includeSkillSchemas
          ? `SCHEMA POLICY:
  - For tool_call/skill_call, "input" MUST match the input schemas under Available tools / Available skills.
  - Do NOT guess or hallucinate field names — use the exact fields from the inline schema.

${formatCapabilitySchemaGuidance(inlineSchemaToolCount)}`
          : `SCHEMA POLICY:
  - Tool and skill names are listed without inline schemas.
  - Call get_capability_schema before every tool_call or skill_call.

${formatCapabilitySchemaGuidance(0)}`;

    const sections = [
      buildIdentitySection(input.soul, input.user),
      buildOutputContractSection(input.sessionId, profile),
      buildReasoningRulesSection(profile),
      buildActionGatesSection(profile),
      buildEfficiencyPolicySection(profile),
      buildMemoryPolicySection(input.sessionId),
      schemaEnforcement,
      buildActionPolicySection(input.sessionId, profile, schemaEnforcement),
      buildFilesSection(input.sessionId, profile),
    ];

    if (profile === "single_skill" && input.primarySkillName && input.primarySkillPrompt) {
      sections.push(buildPrimarySkillSection(input.primarySkillName, input.primarySkillPrompt));
    }

    if (input.toolRegistry.list().length > 0) {
      sections.push(`
==================================================
AVAILABLE TOOLS
==================================================

${tools}`);
    }

    if (skills) {
      sections.push(`
==================================================
AVAILABLE SKILLS
==================================================

${skills}`);
    }

    return sections.filter((section) => section.trim().length > 0).join("\n\n").trim();
  }

  buildDynamic(input: DynamicPromptInput, recentMessages: string): string {
    const memory = input.relevantLongTermMemory
      .map((entry) => `- ${entry.type}: ${entry.content}`)
      .join("\n") || "none";
    return formatAgentUserPrompt(input, recentMessages, memory, "Recent context", "ORIGINAL USER REQUEST");
  }
}
