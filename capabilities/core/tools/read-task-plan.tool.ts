import { z } from "zod";
import { MemoryManager } from "../../../managers/memory-manager.js";
import type { Tool, ToolContext } from "../../../common/interfaces/types.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../../common/services/zod-tool-schema.js";
import { emptyTaskPlanDocument } from "../../../common/services/task-plan-schema.js";

const readTaskPlanInputSchema = z.object({
  create_if_missing: z
    .boolean()
    .optional()
    .describe("If true and no plan exists yet, create an empty plan file."),
});

export class ReadTaskPlanTool implements Tool {
  name = "read_task_plan";
  description =
    "Read the task plan JSON: id, status, optional title, notes (short facts), artifact_path (workspace/ file for full output). Resolves to the principal session when delegated.";
  inputSchema = zodSchemaToJsonInputSchema(readTaskPlanInputSchema);

  constructor(private readonly memoryManager: MemoryManager) {}

  async run(input: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const opts = parseToolInput(this.name, readTaskPlanInputSchema, input);
    const ownerId = await this.memoryManager.resolveTaskPlanSessionId(context.sessionId);
    let doc = await this.memoryManager.readTaskPlan(ownerId);
    if (!doc && opts.create_if_missing) {
      doc = emptyTaskPlanDocument();
      await this.memoryManager.writeTaskPlan(ownerId, doc);
    }
    return doc ?? emptyTaskPlanDocument();
  }
}
