import { MemoryManager } from "../../../managers/memory-manager.js";
import type { Tool, ToolContext } from "../../../common/interfaces/types.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../../common/services/zod-tool-schema.js";
import {
  emptyTaskPlanDocument,
  patchTaskPlanTaskInputSchema,
  type PatchTaskPlanTaskInput,
  type TaskPlanDocument,
  type TaskPlanItem,
} from "../../../common/services/task-plan-schema.js";

export class PatchTaskPlanTaskTool implements Tool {
  name = "patch_task_plan_task";
  description = "Update a single task in the plan by ID, or append it if not found. Fields: status, title, notes, artifact_path, blocked_reason.";
  inputSchema = zodSchemaToJsonInputSchema(patchTaskPlanTaskInputSchema);

  constructor(private readonly memoryManager: MemoryManager) {}

  async run(input: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const ownerId = await this.memoryManager.resolveTaskPlanSessionId(context.sessionId);
    const patch = parseToolInput(this.name, patchTaskPlanTaskInputSchema, input);
    const doc: TaskPlanDocument =
      (await this.memoryManager.readTaskPlan(ownerId)) ?? emptyTaskPlanDocument();
    const existing = doc.tasks.find((t) => t.id === patch.id);
    const merged: TaskPlanItem = mergeTask(existing, patch);
    const nextTasks = existing
      ? doc.tasks.map((t) => (t.id === patch.id ? merged : t))
      : [...doc.tasks, merged];
    const next: TaskPlanDocument = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      tasks: nextTasks,
    };
    await this.memoryManager.writeTaskPlan(ownerId, next);
    return next;
  }
}

function mergeTask(
  existing: TaskPlanItem | undefined,
  patch: PatchTaskPlanTaskInput,
): TaskPlanItem {
  const title = patch.title !== undefined ? patch.title : existing?.title;
  const notes =
    patch.notes !== undefined
      ? patch.notes.length > 0
        ? patch.notes
        : undefined
      : existing?.notes;
  const artifact_path =
    patch.artifact_path !== undefined
      ? patch.artifact_path.length > 0
        ? patch.artifact_path
        : undefined
      : existing?.artifact_path;
  const instruction =
    patch.instruction !== undefined
      ? patch.instruction.length > 0
        ? patch.instruction
        : undefined
      : existing?.instruction;

  let blocked_reason: string | undefined;
  if (patch.blocked_reason !== undefined) {
    blocked_reason = patch.blocked_reason;
  } else if (patch.status === "blocked") {
    blocked_reason = existing?.blocked_reason;
  } else {
    blocked_reason = undefined;
  }

  const item: TaskPlanItem = {
    id: patch.id,
    status: patch.status,
  };
  if (title !== undefined && title.length > 0) {
    item.title = title;
  }
  if (notes !== undefined && notes.length > 0) {
    item.notes = notes;
  }
  if (artifact_path !== undefined && artifact_path.length > 0) {
    item.artifact_path = artifact_path;
  }
  if (blocked_reason !== undefined) {
    item.blocked_reason = blocked_reason;
  }
  if (instruction !== undefined && instruction.length > 0) {
    item.instruction = instruction;
  }

  if (existing?.depends_on) {
    item.depends_on = existing.depends_on;
  }
  if (existing?.tool_names) {
    item.tool_names = existing.tool_names;
  }
  if (existing?.skill_names) {
    item.skill_names = existing.skill_names;
  }

  return item;
}
