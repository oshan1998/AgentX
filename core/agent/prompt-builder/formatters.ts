import type { SkillRegistry, ToolRegistry } from "../../../common/interfaces/registry.js";
import type { LongTermMemoryEntry, Skill } from "../../../common/interfaces/types.js";
import { SkillType } from "../../../common/interfaces/types.js";
import { formatInputSchemaForPrompt } from "../../../common/services/format-input-schema.js";

function formatSkillCatalogLine(s: Skill, includeSchemas: boolean): string {
  const tag = s.kind === SkillType.Agentic ? SkillType.Agentic : SkillType.Workflow;
  const head = `- ${s.name} [${tag}]${s.description ? `: ${s.description}` : ""}`;
  if (!includeSchemas) return head;
  const schemaLines = formatInputSchemaForPrompt(s.inputSchema);
  return schemaLines ? `${head}\n${schemaLines}` : head;
}

export function formatToolCatalog(toolRegistry: ToolRegistry, includeSchemas: boolean): string {
  return (
    toolRegistry
      .list()
      .map((t) => {
        const head = `- ${t.name}${t.description ? `: ${t.description}` : ""}`;
        if (!includeSchemas) return head;
        const schemaLines = formatInputSchemaForPrompt(t.inputSchema);
        return schemaLines ? `${head}\n${schemaLines}` : head;
      })
      .join(includeSchemas ? "\n\n" : "\n") || "none"
  );
}

export function formatSkillCatalog(skillRegistry: SkillRegistry, includeSchemas: boolean): string {
  return (
    skillRegistry.list().map((s) => formatSkillCatalogLine(s, includeSchemas)).join(includeSchemas ? "\n\n" : "\n") ||
    "none"
  );
}

export function formatCapabilitySchemaGuidance(): string {
  return `
MANDATORY SCHEMA LOOKUP RULE:
You MUST call get_capability_schema BEFORE every tool_call or skill_call.
The ONLY exception: you already called get_capability_schema for that exact tool/skill
in THIS session and you remember the exact field names and types.

If you skip this step and guess input fields, the call WILL FAIL with a validation error.
Do NOT invent, assume, or hallucinate field names — always verify first.

Required two-step pattern:
  Step 1: { "type": "tool_call", "tool": "get_capability_schema", "input": { "kind": "tool"|"skill", "name": "<exact_name>" } }
  Step 2 (after observing schema): { "type": "tool_call"|"skill_call", "tool"|"skill": "<name>", "input": { ... exact fields from schema ... } }

WRONG: Calling a tool/skill without first confirming its schema.
`.trim();
}

export function formatMemorySection(relevantLongTermMemory: LongTermMemoryEntry[]): string {
  return relevantLongTermMemory.map((m) => `- ${m.type}: ${m.content}`).join("\n") || "none";
}
