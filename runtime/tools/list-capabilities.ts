/**
 * Tool: list_capabilities
 *
 * Returns the master tool and skill registries. Manually registered in main.ts
 * because it needs registry-scoped dependencies (not MemoryManager-only).
 */
import { z } from "zod";
import type { SkillRegistry, ToolRegistry } from "../../common/interfaces/registry.js";
import type { Skill, Tool, ToolContext } from "../../common/interfaces/types.js";
import { SkillType } from "../../common/interfaces/types.js";
import { DELEGATE_SUB_AGENT_TOOL_NAME } from "../../core/agent/agent-runtime-constants.js";
import { ORCHESTRATE_TASK_GRAPH_TOOL_NAME } from "./orchestrate-task-graph.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../common/services/zod-tool-schema.js";

export const LIST_CAPABILITIES_TOOL_NAME = "list_capabilities";

const META_TOOL_NAMES = new Set([
  DELEGATE_SUB_AGENT_TOOL_NAME,
  ORCHESTRATE_TASK_GRAPH_TOOL_NAME,
  LIST_CAPABILITIES_TOOL_NAME,
  "read_task_plan",
  "write_task_plan",
  "patch_task_plan_task",
]);

export const listCapabilitiesInputSchema = z
  .object({
    include_schemas: z
      .boolean()
      .optional()
      .describe("When true, include inputSchema for each tool and skill. Default: false."),
    exclude_meta: z
      .boolean()
      .optional()
      .describe(
        "When true (default), omit meta/planning tools (delegate, orchestrate, task-plan, list_capabilities).",
      ),
  })
  .describe("All fields optional; omit or use {} for defaults.");

export type ListCapabilitiesInput = z.infer<typeof listCapabilitiesInputSchema>;

function serializeTool(tool: Tool, includeSchemas: boolean): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    name: tool.name,
    description: tool.description,
  };
  if (includeSchemas && tool.inputSchema) {
    entry.inputSchema = tool.inputSchema;
  }
  return entry;
}

function serializeSkill(skill: Skill, includeSchemas: boolean): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    name: skill.name,
    kind: skill.kind === SkillType.Agentic ? SkillType.Agentic : SkillType.Workflow,
    description: skill.description,
  };
  if (includeSchemas && skill.inputSchema) {
    entry.inputSchema = skill.inputSchema;
  }
  return entry;
}

export class ListCapabilitiesTool implements Tool {
  readonly name = LIST_CAPABILITIES_TOOL_NAME;
  readonly description =
    "List all registered tools and skills (name, description, kind). Use exact names when assigning tool_names or skill_names in a task plan.";
  readonly inputSchema = zodSchemaToJsonInputSchema(listCapabilitiesInputSchema);

  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly skillRegistry: SkillRegistry,
  ) {}

  async run(input: Record<string, unknown>, _context: ToolContext): Promise<unknown> {
    const opts = parseToolInput(this.name, listCapabilitiesInputSchema, input);
    const includeSchemas = opts.include_schemas === true;
    const excludeMeta = opts.exclude_meta !== false;

    let tools = this.toolRegistry.list();
    if (excludeMeta) {
      tools = tools.filter((t) => !META_TOOL_NAMES.has(t.name));
    }

    const skills = this.skillRegistry.list();

    return {
      tools: tools.map((t) => serializeTool(t, includeSchemas)),
      skills: skills.map((s) => serializeSkill(s, includeSchemas)),
    };
  }
}
