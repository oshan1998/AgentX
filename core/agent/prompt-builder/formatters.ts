import type { SkillRegistry, ToolRegistry } from "../../../common/interfaces/registry.js";
import type { LongTermMemoryEntry, Skill, Tool } from "../../../common/interfaces/types.js";
import { SkillType } from "../../../common/interfaces/types.js";
import { formatInputSchemaForPrompt } from "../../../common/services/format-input-schema.js";

export interface FormatToolCatalogOptions {
  /** MCP server registry keys whose tools get full input schemas inlined. */
  inlineSchemaMcpServers?: ReadonlySet<string>;
  /** When true (default), non-MCP local tools always include schemas. */
  inlineLocalSchemas?: boolean;
}

function shouldInlineToolSchema(
  tool: Tool,
  includeAllSchemas: boolean,
  options?: FormatToolCatalogOptions,
): boolean {
  if (includeAllSchemas) return true;
  if (!tool.mcpServer) {
    return options?.inlineLocalSchemas === true;
  }
  return options?.inlineSchemaMcpServers?.has(tool.mcpServer) ?? false;
}

function formatToolLine(tool: Tool, includeSchema: boolean): string {
  const head = `- ${tool.name}${tool.description ? `: ${tool.description}` : ""}`;
  if (!includeSchema) return head;
  const schemaLines = formatInputSchemaForPrompt(tool.inputSchema);
  return schemaLines ? `${head}\n${schemaLines}` : head;
}

function formatSkillCatalogLine(s: Skill, includeSchemas: boolean): string {
  const tag = s.kind === SkillType.Agentic ? SkillType.Agentic : SkillType.Workflow;
  const head = `- ${s.name} [${tag}]${s.description ? `: ${s.description}` : ""}`;
  if (!includeSchemas) return head;
  const schemaLines = formatInputSchemaForPrompt(s.inputSchema);
  return schemaLines ? `${head}\n${schemaLines}` : head;
}

export function formatToolCatalog(
  toolRegistry: ToolRegistry,
  includeSchemas: boolean,
  options?: FormatToolCatalogOptions,
): string {
  const lines = toolRegistry.list().map((t) => {
    const inline = shouldInlineToolSchema(t, includeSchemas, options);
    return formatToolLine(t, inline);
  });
  const hasBlockSchema = includeSchemas || lines.some((line) => line.includes("\n"));
  return lines.join(hasBlockSchema ? "\n\n" : "\n") || "none";
}

export function countInlineSchemaTools(
  toolRegistry: ToolRegistry,
  includeAllSchemas: boolean,
  options?: FormatToolCatalogOptions,
): number {
  return toolRegistry.list().filter((t) => shouldInlineToolSchema(t, includeAllSchemas, options))
    .length;
}

export function formatSkillCatalog(skillRegistry: SkillRegistry, includeSchemas: boolean): string {
  return (
    skillRegistry.list().map((s) => formatSkillCatalogLine(s, includeSchemas)).join(includeSchemas ? "\n\n" : "\n") ||
    "none"
  );
}

export function formatCapabilitySchemaGuidance(inlineSchemaToolCount = 0): string {
  if (inlineSchemaToolCount > 0) {
    return `
SCHEMA RULES:
- Tools with an "input:" block under Available tools can be called directly — use those exact field names.
- Tools listed without an input block, and all skills, still require get_capability_schema before tool_call or skill_call
  (unless you already fetched that exact schema earlier in this session).

Pattern for tools without an inline schema:
  Step 1: { "type": "tool_call", "tool": "get_capability_schema", "input": { "kind": "tool"|"skill", "name": "<exact_name>" } }
  Step 2: { "type": "tool_call"|"skill_call", ... } using the observed schema fields.

Do NOT guess or hallucinate input fields.`.trim();
  }

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
