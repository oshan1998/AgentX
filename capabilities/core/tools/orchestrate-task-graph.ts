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

// ─── Schema ──────────────────────────────────────────────────────────────────

const taskNodeInputSchema = z.object({
  id: z.string().min(1).describe("Stable snake_case id for this task (e.g. market_overview)."),
  title: z.string().min(1).describe("Human-readable title."),
  dependsOn: z
    .array(z.string())
    .default([])
    .describe("IDs of tasks that must complete before this one starts. Empty = no dependencies."),
  instruction: z.string().min(1).describe("Clear task instructions for the sub-agent worker."),
  toolNames: z
    .array(z.string())
    .default([])
    .describe("Tool names the worker may use (subset of your catalog)."),
  skillNames: z
    .array(z.string())
    .optional()
    .describe("Skill names the worker may use (optional subset of your catalog)."),
  artifactPath: z
    .string()
    .optional()
    .describe("Path under workspace/ where the worker should write its full output."),
});

const orchestrateInputSchema = z.object({
  objective: z.string().min(1).describe("High-level objective that this task graph achieves."),
  tasks: z
    .array(taskNodeInputSchema)
    .min(1)
    .describe("Ordered list of task nodes forming a DAG. Use dependsOn to express dependencies."),
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

    const graphConfig: TaskGraphConfig = {
      objective: validated.objective,
      nodes: validated.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        dependsOn: t.dependsOn,
        instruction: t.instruction,
        toolNames: t.toolNames,
        skillNames: t.skillNames,
        artifactPath: t.artifactPath,
        status: TaskNodeStatus.Pending,
      })),
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
