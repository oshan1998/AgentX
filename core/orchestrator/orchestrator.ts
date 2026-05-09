import type { SkillRegistry, ToolRegistry } from "../../common/interfaces/registry.js";
import type { LlmAdapter, SkillDelegateRunner } from "../../common/interfaces/types.js";
import type { SessionTraceHub } from "../../common/realtime/session-trace-hub.js";
import { MemoryManager } from "../../managers/memory-manager.js";
import { ProfileManager } from "../../managers/profile-manager.js";
import { logger } from "../../common/services/logger.js";
import { OrchestratorEventBus } from "./event-bus.js";
import { TaskGraph, TaskNodeStatus, type TaskGraphConfig, type TaskNode } from "./task-graph.js";
import { Scheduler, type SchedulerConfig, type SchedulerResult } from "./scheduler.js";
import { WorkerPool, type WorkerPoolConfig } from "./worker-pool.js";
import { AgentTracePhase } from "../../common/realtime/agent-trace-types.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OrchestratorDeps {
  llm: LlmAdapter;
  memoryManager: MemoryManager;
  profileManager: ProfileManager;
  masterToolRegistry: ToolRegistry;
  masterSkillRegistry: SkillRegistry;
  sessionTraceHub?: SessionTraceHub;
  skillDelegateRunner?: SkillDelegateRunner;
}

export interface OrchestratorConfig {
  worker?: WorkerPoolConfig;
  scheduler?: SchedulerConfig;
}

export interface OrchestrateInput {
  /** The DAG definition produced by the planner. */
  graph: TaskGraphConfig;
  /** Session that owns this orchestrated run. */
  sessionId: string;
  /** Optional run ID for trace linkage. */
  runId?: string;
  /** Abort signal from the caller. */
  abortSignal?: AbortSignal;
}

export interface OrchestrateResult {
  /** True if all tasks completed without failures. */
  success: boolean;
  /** Number of tasks that completed. */
  completedCount: number;
  /** Number of tasks that failed. */
  failedCount: number;
  /** Task ID → result summary from each completed task. */
  results: Record<string, string>;
  /** Task ID → error message for failed/skipped tasks. */
  errors: Record<string, string>;
  /** Human-readable summary of the run. */
  summary: string;
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

/**
 * Façade for DAG-based parallel task execution.
 *
 * Usage:
 * ```ts
 * const orchestrator = new Orchestrator(deps);
 * const result = await orchestrator.run({
 *   graph: { objective: "...", nodes: [...] },
 *   sessionId: "...",
 * });
 * ```
 *
 * Internally wires: TaskGraph → Scheduler → WorkerPool → EventBus
 */
export class Orchestrator {
  constructor(
    private readonly deps: OrchestratorDeps,
    private readonly config: OrchestratorConfig = {},
  ) {}

  async run(input: OrchestrateInput): Promise<OrchestrateResult> {
    const { graph: graphConfig, sessionId, runId, abortSignal } = input;
    const hub = this.deps.sessionTraceHub;

    logger.info(
      `[Orchestrator] Starting orchestrated run for "${graphConfig.objective}" ` +
      `with ${graphConfig.nodes.length} tasks.`,
    );

    // Emit trace start
    if (hub && runId) {
      hub.emitTraceStep(sessionId, runId, {
        step: "thought",
        iteration: 0,
        phase: AgentTracePhase.START,
        text: `Orchestrating ${graphConfig.nodes.length} tasks in parallel: ${graphConfig.objective}`,
      });
    }

    // Construct components
    const taskGraph = new TaskGraph(graphConfig);
    const eventBus = new OrchestratorEventBus();

    const workerPool = new WorkerPool(
      {
        llm: this.deps.llm,
        memoryManager: this.deps.memoryManager,
        profileManager: this.deps.profileManager,
        masterToolRegistry: this.deps.masterToolRegistry,
        masterSkillRegistry: this.deps.masterSkillRegistry,
        sessionTraceHub: this.deps.sessionTraceHub,
        skillDelegateRunner: this.deps.skillDelegateRunner,
      },
      eventBus,
      this.config.worker,
    );

    const scheduler = new Scheduler(
      taskGraph,
      workerPool,
      eventBus,
      this.config.scheduler,
    );

    // Wire trace events
    if (hub && runId) {
      eventBus.on("task_started", (evt) => {
        hub.emitTraceStep(sessionId, runId, {
          step: "tool",
          iteration: evt.workerId,
          name: `task:${evt.taskId}`,
          phase: AgentTracePhase.START,
        });
      });

      eventBus.on("task_completed", (evt) => {
        hub.emitTraceStep(sessionId, runId, {
          step: "tool",
          iteration: evt.workerId,
          name: `task:${evt.taskId}`,
          phase: AgentTracePhase.END,
        });
      });

      eventBus.on("task_failed", (evt) => {
        hub.emitTraceStep(sessionId, runId, {
          step: "tool",
          iteration: evt.workerId,
          name: `task:${evt.taskId}:failed`,
          phase: AgentTracePhase.END,
        });
      });
    }

    // Run the scheduler
    let schedulerResult: SchedulerResult;
    try {
      schedulerResult = await scheduler.run(sessionId, abortSignal);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error(`[Orchestrator] Scheduler failed: ${error}`);
      eventBus.removeAllListeners();

      return {
        success: false,
        completedCount: 0,
        failedCount: 1,
        results: {},
        errors: { _scheduler: error },
        summary: `Orchestration failed: ${error}`,
      };
    }

    // Build summary
    const summary = this.buildSummary(
      graphConfig.objective,
      taskGraph.getAllNodes(),
      schedulerResult,
    );

    // Emit trace end
    if (hub && runId) {
      hub.emitTraceStep(sessionId, runId, {
        step: "thought",
        iteration: 0,
        phase: AgentTracePhase.END,
        text: summary,
      });
    }

    logger.info(
      `[Orchestrator] Run complete. ${schedulerResult.completedCount} completed, ` +
      `${schedulerResult.failedCount} failed.`,
    );

    eventBus.removeAllListeners();

    return {
      ...schedulerResult,
      summary,
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private buildSummary(
    objective: string,
    nodes: TaskNode[],
    result: SchedulerResult,
  ): string {
    const lines: string[] = [
      `## Orchestration Complete: ${objective}`,
      "",
      `**Results**: ${result.completedCount} completed, ${result.failedCount} failed, ` +
      `${nodes.filter((n) => n.status === TaskNodeStatus.Skipped).length} skipped`,
      "",
    ];

    // Completed tasks
    const completed = nodes.filter(
      (n) => n.status === TaskNodeStatus.Completed,
    );
    if (completed.length > 0) {
      lines.push("### Completed Tasks");
      for (const n of completed) {
        const preview = n.result
          ? n.result.slice(0, 200) + (n.result.length > 200 ? "…" : "")
          : "(no result)";
        lines.push(`- **${n.title}** (${n.id}): ${preview}`);
      }
      lines.push("");
    }

    // Failed/skipped tasks
    const failed = nodes.filter(
      (n) =>
        n.status === TaskNodeStatus.Failed ||
        n.status === TaskNodeStatus.Skipped,
    );
    if (failed.length > 0) {
      lines.push("### Failed/Skipped Tasks");
      for (const n of failed) {
        lines.push(
          `- **${n.title}** (${n.id}): ${n.status} — ${n.error ?? "unknown error"}`,
        );
      }
      lines.push("");
    }

    return lines.join("\n");
  }
}
