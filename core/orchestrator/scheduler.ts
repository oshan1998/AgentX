import { logger } from "../../common/services/logger.js";
import type { OrchestratorEventBus } from "./event-bus.js";
import { TaskGraph, TaskNodeStatus } from "./task-graph.js";
import type { WorkerPool } from "./worker-pool.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SchedulerConfig {
  /** When true, fail the entire graph on the first task failure. Defaults to false. */
  failFast?: boolean;
}

export interface SchedulerResult {
  success: boolean;
  completedCount: number;
  failedCount: number;
  results: Record<string, string>;
  errors: Record<string, string>;
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

/**
 * Event-driven scheduler that dispatches ready tasks from the DAG to the worker pool.
 *
 * Lifecycle:
 * 1. `run()` is called — scheduler dispatches all initially-ready tasks.
 * 2. Each `task_completed` promotes dependents in the DAG → scheduler dispatches newly-ready tasks.
 * 3. Each `task_failed` marks dependents as skipped → scheduler re-evaluates.
 * 4. When the graph is fully terminal, the scheduler resolves the returned promise.
 */
export class Scheduler {
  private readonly failFast: boolean;

  constructor(
    private readonly graph: TaskGraph,
    private readonly pool: WorkerPool,
    private readonly eventBus: OrchestratorEventBus,
    config?: SchedulerConfig,
  ) {
    this.failFast = config?.failFast ?? false;
  }

  /**
   * Run the full DAG to completion.
   * Returns a summary of all task outcomes.
   */
  async run(
    parentSessionId: string,
    abortSignal?: AbortSignal,
  ): Promise<SchedulerResult> {
    return new Promise<SchedulerResult>((resolve, reject) => {
      // Wire up event handlers
      const onCompleted = (evt: { taskId: string; result: string }) => {
        try {
          this.graph.markCompleted(evt.taskId, evt.result);
          logger.info(`[Scheduler] Task "${evt.taskId}" completed.`);
          this.dispatchReady(parentSessionId, abortSignal);
          this.checkDone(resolve);
        } catch (err) {
          cleanup();
          reject(err);
        }
      };

      const onFailed = (evt: { taskId: string; error: string }) => {
        try {
          this.graph.markFailed(evt.taskId, evt.error);
          logger.warn(`[Scheduler] Task "${evt.taskId}" failed: ${evt.error}`);

          if (this.failFast) {
            this.pool.cancelAll();
            cleanup();
            resolve(this.buildResult());
            return;
          }

          this.dispatchReady(parentSessionId, abortSignal);
          this.checkDone(resolve);
        } catch (err) {
          cleanup();
          reject(err);
        }
      };

      const cleanup = () => {
        this.eventBus.removeAllListeners();
      };

      this.eventBus.on("task_completed", onCompleted);
      this.eventBus.on("task_failed", onFailed);

      // Handle abort
      if (abortSignal) {
        if (abortSignal.aborted) {
          cleanup();
          resolve(this.buildResult());
          return;
        }
        abortSignal.addEventListener(
          "abort",
          () => {
            this.pool.cancelAll();
            cleanup();
            resolve(this.buildResult());
          },
          { once: true },
        );
      }

      // Initial dispatch
      this.dispatchReady(parentSessionId, abortSignal);

      // Edge case: graph has no tasks or all tasks are already terminal
      this.checkDone(resolve);
    });
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private dispatchReady(
    parentSessionId: string,
    abortSignal?: AbortSignal,
  ): void {
    const ready = this.graph.getReadyTasks();

    for (const task of ready) {
      if (this.pool.availableSlots <= 0) {
        logger.debug(
          `[Scheduler] Pool full — deferring task "${task.id}" until a slot opens.`,
        );
        break;
      }

      this.graph.markRunning(task.id);
      this.pool.submit(task, parentSessionId, abortSignal);
      logger.info(
        `[Scheduler] Dispatched task "${task.id}" (${task.title}).`,
      );
    }
  }

  private checkDone(resolve: (result: SchedulerResult) => void): void {
    if (this.graph.isFinished() && this.pool.activeCount === 0) {
      this.eventBus.removeAllListeners();
      const result = this.buildResult();

      this.eventBus.emit("graph_done", {
        completedCount: result.completedCount,
        failedCount: result.failedCount,
        ts: new Date().toISOString(),
      });

      resolve(result);
    }
  }

  private buildResult(): SchedulerResult {
    const results: Record<string, string> = {};
    const errors: Record<string, string> = {};

    for (const node of this.graph.getAllNodes()) {
      if (
        node.status === TaskNodeStatus.Completed &&
        node.result
      ) {
        results[node.id] = node.result;
      }
      if (
        (node.status === TaskNodeStatus.Failed ||
          node.status === TaskNodeStatus.Skipped) &&
        node.error
      ) {
        errors[node.id] = node.error;
      }
    }

    const completedCount = this.graph.getCompletedCount();
    const failedCount = this.graph.getFailedCount();

    return {
      success: failedCount === 0,
      completedCount,
      failedCount,
      results,
      errors,
    };
  }
}
