import { z } from "zod";

export const taskPlanStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "blocked",
]);

export const taskPlanItemSchema = z.object({
  id: z.string().min(1).describe("Stable machine id for the step (e.g. market_overview)."),
  status: taskPlanStatusSchema,
  title: z.string().optional().describe("Human-readable label for the step."),
  notes: z
    .string()
    .optional()
    .describe(
      "Compact findings / facts for this step so later turns need not rely on chat memory. Prefer storing large material via artifact_path + write_file.",
    ),
  artifact_path: z
    .string()
    .optional()
    .describe(
      "Relative path in this session workspace for full step output (e.g. tasks/market_overview.md). Use the same path with read_file/write_file in later steps.",
    ),
  blocked_reason: z
    .string()
    .optional()
    .describe("Why this task is blocked (dependencies, missing input, failure)."),
  depends_on: z
    .array(z.string())
    .optional()
    .describe(
      "IDs of tasks that must complete before this one starts. Empty or omitted = no dependencies (can run immediately). Used by orchestrate_task_graph for parallel execution.",
    ),
  tool_names: z
    .array(z.string())
    .optional()
    .describe(
      "Tool names the worker sub-agent may use for this task. Used by orchestrate_task_graph.",
    ),
  skill_names: z
    .array(z.string())
    .optional()
    .describe(
      "Skill names the worker sub-agent may use for this task. Used by orchestrate_task_graph.",
    ),
  instruction: z
    .string()
    .optional()
    .describe(
      "Clear, detailed task instructions for the worker sub-agent. Used by orchestrate_task_graph.",
    ),
});

export const taskPlanDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  updatedAt: z.string(),
  tasks: z.array(taskPlanItemSchema),
});

export const writeTaskPlanInputSchema = z.object({
  tasks: z.array(taskPlanItemSchema).describe("Full ordered task list; replaces any existing plan."),
});

export const patchTaskPlanTaskInputSchema = z.object({
  id: z.string().min(1),
  status: taskPlanStatusSchema,
  title: z.string().optional(),
  notes: z
    .string()
    .optional()
    .describe("Replace task notes; use empty string to clear. Leave unset to keep previous."),
  artifact_path: z
    .string()
    .optional()
    .describe("Set or change session workspace path (relative, e.g. tasks/foo.md); empty string clears. Leave unset to keep previous."),
  blocked_reason: z.string().optional(),
  instruction: z.string().optional().describe("Update task instructions; leave unset to keep previous."),
});

export type TaskPlanStatus = z.infer<typeof taskPlanStatusSchema>;
export type TaskPlanItem = z.infer<typeof taskPlanItemSchema>;
export type TaskPlanDocument = z.infer<typeof taskPlanDocumentSchema>;
export type WriteTaskPlanInput = z.infer<typeof writeTaskPlanInputSchema>;
export type PatchTaskPlanTaskInput = z.infer<typeof patchTaskPlanTaskInputSchema>;

export function emptyTaskPlanDocument(): TaskPlanDocument {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    tasks: [],
  };
}
