import { randomUUID } from "node:crypto";
import type { SkillRegistry, ToolRegistry } from "../../common/interfaces/registry.js";
import type { LlmAdapter, SkillDelegateRunner } from "../../common/interfaces/types.js";
import type { SessionTraceHub } from "../../common/realtime/session-trace-hub.js";
import { MemoryManager } from "../../managers/memory-manager.js";
import { ProfileManager } from "../../managers/profile-manager.js";
import { AgentLoop, AgentType } from "../agent-loop.js";
import { SUB_AGENT_EXECUTION_POLICY } from "../execution-policy.js";
import { cloneSkillWhitelist, cloneToolWhitelist } from "../sub-agent-registry.js";
import {
  SUB_AGENT_DEFAULT_MAX_ITERATIONS,
  SUB_AGENT_DEFAULT_WALL_CLOCK_MS,
  SUB_AGENT_HARD_MAX_ITERATIONS,
  SUB_AGENT_HARD_MAX_WALL_CLOCK_MS,
} from "../agent-runtime-constants.js";
import { logger } from "../../common/services/logger.js";
import type { OrchestratorEventBus } from "./event-bus.js";
import type { TaskNode } from "./task-graph.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WorkerPoolDeps {
  llm: LlmAdapter;
  memoryManager: MemoryManager;
  profileManager: ProfileManager;
  masterToolRegistry: ToolRegistry;
  masterSkillRegistry: SkillRegistry;
  sessionTraceHub?: SessionTraceHub;
  skillDelegateRunner?: SkillDelegateRunner;
}

export interface WorkerPoolConfig {
  /** Maximum concurrent sub-agent workers. Defaults to 3. */
  maxConcurrency?: number;
}

interface ActiveWorker {
  workerId: number;
  taskId: string;
  promise: Promise<void>;
  abort: AbortController;
}

// ─── Worker Pool ─────────────────────────────────────────────────────────────

/**
 * Manages a bounded pool of concurrent sub-agent runs.
 * Each worker spins up an isolated `AgentLoop` (sub-agent mode) for one task node.
 * Results and errors are communicated through the event bus.
 */
export class WorkerPool {
  private readonly maxConcurrency: number;
  private readonly workers: Map<string, ActiveWorker> = new Map();
  private nextWorkerId = 1;

  constructor(
    private readonly deps: WorkerPoolDeps,
    private readonly eventBus: OrchestratorEventBus,
    config?: WorkerPoolConfig,
  ) {
    this.maxConcurrency = config?.maxConcurrency ?? 3;
  }

  get activeCount(): number {
    return this.workers.size;
  }

  get availableSlots(): number {
    return Math.max(0, this.maxConcurrency - this.workers.size);
  }

  /**
   * Submit a task node for execution. Returns immediately.
   * The worker runs asynchronously and emits `task_completed` or `task_failed` on the event bus.
   */
  submit(
    task: TaskNode,
    parentSessionId: string,
    parentAbortSignal?: AbortSignal,
  ): void {
    if (this.workers.size >= this.maxConcurrency) {
      throw new Error(
        `WorkerPool at capacity (${this.maxConcurrency}). Cannot submit task "${task.id}".`,
      );
    }

    const workerId = this.nextWorkerId++;
    const ac = new AbortController();

    // Chain parent abort signal
    if (parentAbortSignal) {
      if (parentAbortSignal.aborted) {
        ac.abort();
      } else {
        parentAbortSignal.addEventListener("abort", () => ac.abort(), {
          once: true,
        });
      }
    }

    const promise = this.runWorker(
      workerId,
      task,
      parentSessionId,
      ac,
    );

    this.workers.set(task.id, { workerId, taskId: task.id, promise, abort: ac });
  }

  /** Cancel a specific task's worker. */
  cancel(taskId: string): boolean {
    const worker = this.workers.get(taskId);
    if (!worker) return false;
    worker.abort.abort();
    return true;
  }

  /** Cancel all active workers. */
  cancelAll(): void {
    for (const worker of this.workers.values()) {
      worker.abort.abort();
    }
  }

  /** Wait for all currently active workers to finish. */
  async drain(): Promise<void> {
    const promises = [...this.workers.values()].map((w) => w.promise);
    await Promise.allSettled(promises);
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private async runWorker(
    workerId: number,
    task: TaskNode,
    parentSessionId: string,
    ac: AbortController,
  ): Promise<void> {
    const ts = () => new Date().toISOString();

    this.eventBus.emit("task_started", {
      taskId: task.id,
      workerId,
      ts: ts(),
    });

    let result: string | undefined;
    let error: string | undefined;

    try {
      result = await this.executeTask(
        task,
        parentSessionId,
        ac,
      );
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      logger.error(
        `[WorkerPool] Worker ${workerId} failed on task "${task.id}"`,
        { error },
      );
    } finally {
      // CRITICAL: Remove worker from active set BEFORE emitting events.
      // This ensures that Scheduler.checkDone sees activeCount === 0 and
      // availableSlots is correct for subsequent dispatches.
      this.workers.delete(task.id);

      if (error !== undefined) {
        this.eventBus.emit("task_failed", {
          taskId: task.id,
          workerId,
          error,
          ts: ts(),
        });
      } else {
        this.eventBus.emit("task_completed", {
          taskId: task.id,
          workerId,
          result: result!,
          ts: ts(),
        });
      }
    }
  }

  private async executeTask(
    task: TaskNode,
    parentSessionId: string,
    ac: AbortController,
  ): Promise<string> {
    // Create an isolated child session
    const subSessionId =
      await this.deps.memoryManager.createChildSession(parentSessionId);
    const subRunId = randomUUID();

    // Clone allow-listed tools and skills
    const subTools = cloneToolWhitelist(
      this.deps.masterToolRegistry,
      task.tool_names,
    );
    const subSkills = cloneSkillWhitelist(
      this.deps.masterSkillRegistry,
      task.skill_names ?? [],
    );

    // Resolve iteration/deadline caps
    const maxIter = Math.min(
      SUB_AGENT_DEFAULT_MAX_ITERATIONS,
      SUB_AGENT_HARD_MAX_ITERATIONS,
    );
    const deadlineAt =
      Date.now() +
      Math.min(SUB_AGENT_DEFAULT_WALL_CLOCK_MS, SUB_AGENT_HARD_MAX_WALL_CLOCK_MS);

    // Build contextual instruction
    const instruction = this.buildInstruction(task);

    // Spin up an isolated sub-agent loop
    const subLoop = new AgentLoop({
      llm: this.deps.llm,
      memoryManager: this.deps.memoryManager,
      profileManager: this.deps.profileManager,
      toolRegistry: subTools,
      skillRegistry: subSkills,
      maxIterations: maxIter,
      sessionTraceHub: this.deps.sessionTraceHub,
      executionPolicy: SUB_AGENT_EXECUTION_POLICY,
      agentType: AgentType.SubAgent,
      skillDelegateRunner: this.deps.skillDelegateRunner,
    });

    const summary = await subLoop.completeAgentRun(subSessionId, instruction, {
      runId: subRunId,
      abortSignal: ac.signal,
      deadlineAt,
      maxIterations: maxIter,
    });

    logger.info(
      `[WorkerPool] Task "${task.id}" completed with outcome: ${summary.outcome}`,
    );

    return summary.reply;
  }

  private buildInstruction(task: TaskNode): string {
    const lines: string[] = [
      `## Task: ${task.title}`,
      "",
      task.instruction,
    ];

    if (task.artifactPath) {
      lines.push(
        "",
        `Write your complete findings to: ${task.artifactPath}`,
        "Use write_file to persist the output there.",
      );
    }

    lines.push(
      "",
      "When finished, respond with a concise summary of your findings.",
    );

    return lines.join("\n");
  }
}
