import { MemoryManager } from "../managers/memory-manager.js";
import type { Tool, ToolContext } from "../common/interfaces/types.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../common/services/zod-tool-schema.js";
import { writeTaskPlanInputSchema, type TaskPlanDocument } from "../common/services/task-plan-schema.js";

export class WriteTaskPlanTool implements Tool {
  name = "write_task_plan";
  description = "Overwrite the session task plan with a new set of tasks. Each task can carry a status, notes, dependencies, and an output file path.";
  inputSchema = zodSchemaToJsonInputSchema(writeTaskPlanInputSchema);

  constructor(private readonly memoryManager: MemoryManager) {}

  async run(input: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const { tasks } = parseToolInput(this.name, writeTaskPlanInputSchema, input);
    const doc: TaskPlanDocument = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      tasks,
    };
    const ownerId = await this.memoryManager.resolveTaskPlanSessionId(context.sessionId);
    await this.memoryManager.writeTaskPlan(ownerId, doc);
    return doc;
  }
}
