/**
 * Tool: get_capability_schema
 *
 * Returns the input schema for one registered tool or skill by exact name.
 * Manually registered in main.ts because it needs registry-scoped dependencies.
 */
import { z } from "zod";
import type { SkillRegistry, ToolRegistry } from "../../common/interfaces/registry.js";
import type { Tool, ToolContext } from "../../common/interfaces/types.js";
import { SkillType } from "../../common/interfaces/types.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../common/services/zod-tool-schema.js";

export const GET_CAPABILITY_SCHEMA_TOOL_NAME = "get_capability_schema";

const capabilityKindSchema = z.enum(["tool", "skill"]);

export const getCapabilitySchemaInputSchema = z
  .object({
    kind: capabilityKindSchema.describe("Whether to look up a tool or skill."),
    name: z.string().min(1).describe("Exact registered tool or skill name."),
  })
  .describe("Look up input schema for one tool or skill.");

export type GetCapabilitySchemaInput = z.infer<typeof getCapabilitySchemaInputSchema>;

export class GetCapabilitySchemaTool implements Tool {
  readonly name = GET_CAPABILITY_SCHEMA_TOOL_NAME;
  readonly description =
    "Return the input schema (JSON Schema) for one registered tool or skill by exact name. Call before tool_call or skill_call when you need argument details.";
  readonly inputSchema = zodSchemaToJsonInputSchema(getCapabilitySchemaInputSchema);

  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly skillRegistry: SkillRegistry,
  ) {}

  async run(input: Record<string, unknown>, _context: ToolContext): Promise<unknown> {
    const opts = parseToolInput(this.name, getCapabilitySchemaInputSchema, input);
    const name = opts.name.trim();

    if (opts.kind === "tool") {
      const tool = this.toolRegistry.get(name);
      if (!tool) {
        return { ok: false, kind: "tool", name, error: `Tool not found: ${name}` };
      }
      return {
        ok: true,
        kind: "tool",
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema ?? null,
      };
    }

    const skill = this.skillRegistry.get(name);
    if (!skill) {
      return { ok: false, kind: "skill", name, error: `Skill not found: ${name}` };
    }
    return {
      ok: true,
      kind: "skill",
      name: skill.name,
      description: skill.description,
      skillKind: skill.kind === SkillType.Agentic ? SkillType.Agentic : SkillType.Workflow,
      inputSchema: skill.inputSchema ?? null,
    };
  }
}
