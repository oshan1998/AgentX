import type { Tool, ToolContext } from "../../../common/interfaces/types.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../../common/services/zod-tool-schema.js";
import type { ToolDependencies } from "../../../managers/tool-manager.js";
import { writeTaskPlanInputSchema, type TaskPlanDocument } from "../../../common/services/task-plan-schema.js";

export class WriteTaskPlanTool implements Tool {
  name = "write_task_plan";
  description =
    "Replace the entire task plan (full overwrite). Each task may include notes (short findings) and artifact_path (workspace/ file with full material). Persists under memory/sessions/<principal-session>.task-plan.json.";
  inputSchema = zodSchemaToJsonInputSchema(writeTaskPlanInputSchema);

  constructor(private readonly deps: ToolDependencies) {}

  async run(input: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const { tasks } = parseToolInput(this.name, writeTaskPlanInputSchema, input);
    const doc: TaskPlanDocument = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      tasks,
    };
    const ownerId = await this.deps.memoryManager.resolveTaskPlanSessionId(context.sessionId);
    await this.deps.memoryManager.writeTaskPlan(ownerId, doc);
    return doc;
  }
}
