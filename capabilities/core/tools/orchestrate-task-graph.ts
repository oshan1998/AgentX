/**
 * Tool: orchestrate_task_graph
 *
 * Allows the primary agent to submit a DAG of tasks for parallel execution.
 * This tool is manually registered (like delegate_sub_agent) because it needs
 * orchestrator-scoped dependencies.
 */
import { z } from "zod";
import type { Tool, ToolContext } from "../../../common/interfaces/types.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../../common/services/zod-tool-schema.js";
import type { Orchestrator } from "../../../core/orchestrator/orchestrator.js";
import { TaskNodeStatus, type TaskGraphConfig } from "../../../core/orchestrator/task-graph.js";

const orchestrateInputSchema = z.object({
  objective: z.string().min(1).describe("High-level objective that this task graph achieves."),
  failFast: z
    .boolean()
    .optional()
    .describe("When true, cancel all remaining tasks on first failure. Default: false."),
  maxConcurrency: z
    .number()
    .positive()
    .optional()
    .describe("Maximum parallel workers. Default: 3."),
});

export type OrchestrateTaskGraphInput = z.infer<typeof orchestrateInputSchema>;

// ─── Tool ────────────────────────────────────────────────────────────────────

export const ORCHESTRATE_TASK_GRAPH_TOOL_NAME = "orchestrate_task_graph";

export class OrchestrateTaskGraphTool implements Tool {
  readonly name = ORCHESTRATE_TASK_GRAPH_TOOL_NAME;
  readonly description =
    "Execute a DAG of tasks in parallel using isolated sub-agent workers. " +
    "Tasks without dependencies run concurrently; tasks with dependsOn wait for their upstream tasks to complete. " +
    "Use this instead of sequential delegate_sub_agent calls when you have multiple independent or semi-independent tasks. " +
    "Workers cannot write memory or profiles — include facts in results for you to persist.";
  readonly inputSchema = zodSchemaToJsonInputSchema(orchestrateInputSchema);

  constructor(private readonly orchestrator: Orchestrator) {}

  async run(
    input: Record<string, unknown>,
    context: ToolContext,
  ): Promise<unknown> {
    const validated = parseToolInput(
      this.name,
      orchestrateInputSchema,
      input,
    );

    const ownerId = await this.orchestrator.deps.memoryManager.resolveTaskPlanSessionId(context.sessionId);
    const doc = await this.orchestrator.deps.memoryManager.readTaskPlan(ownerId);

    if (!doc || !doc.tasks || doc.tasks.length === 0) {
      throw new Error("No task plan found for this session. Please use the 'plan_steps' skill to design a plan first.");
    }

    const graphConfig: TaskGraphConfig = {
      objective: validated.objective,
      nodes: doc.tasks.map((t) => {
        let status = TaskNodeStatus.Pending;
        if (t.status === "completed") {
          status = TaskNodeStatus.Completed;
        }
        return {
          id: t.id,
          title: t.title ?? t.id,
          depends_on: t.depends_on ?? [],
          instruction: t.instruction ?? t.notes ?? "",
          tool_names: t.tool_names ?? [],
          skill_names: t.skill_names ?? [],
          artifactPath: t.artifact_path,
          status,
        };
      }),
    };

    const result = await this.orchestrator.run({
      graph: graphConfig,
      sessionId: context.sessionId,
      runId: context.runId,
      abortSignal: context.abortSignal,
    });

    return JSON.stringify({
      ok: result.success,
      objective: validated.objective,
      completedCount: result.completedCount,
      failedCount: result.failedCount,
      results: result.results,
      errors: Object.keys(result.errors).length > 0 ? result.errors : undefined,
      summary: result.summary,
    });
  }
}
