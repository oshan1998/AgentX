import { randomUUID } from "node:crypto";
import type { SkillRegistry, ToolRegistry } from "../../common/interfaces/registry.js";
import type { LlmAdapter, SkillDelegateRunner } from "../../common/interfaces/types.js";
import type { SessionTraceHub } from "../../common/realtime/session-trace-hub.js";
import { MemoryManager } from "../../managers/memory-manager.js";
import { ProfileManager } from "../../managers/profile-manager.js";
import { AgentLoop, AgentType } from "../agent/agent-loop.js";
import { SUB_AGENT_EXECUTION_POLICY } from "../agent/execution-policy.js";
import { cloneSkillWhitelist, cloneToolWhitelist } from "../agent/sub-agent-registry.js";
import {
  SUB_AGENT_DEFAULT_MAX_ITERATIONS,
  SUB_AGENT_DEFAULT_WALL_CLOCK_MS,
  SUB_AGENT_HARD_MAX_ITERATIONS,
  SUB_AGENT_HARD_MAX_WALL_CLOCK_MS,
} from "../agent/agent-runtime-constants.js";
import { logger } from "../../common/services/logger.js";
import {
  DEFAULT_WORKSPACE_BASE,
  normalizeWorkspaceRelativePath,
  sessionArtifactExists,
} from "../../common/services/workspace-path.js";
import type { OrchestratorEventBus } from "./event-bus.js";
import { TaskGraph, type TaskNode } from "./task-graph.js";

const UPSTREAM_SUMMARY_MAX_CHARS = 600;
/** Extra sub-agent turns when a required artifact file is missing after respond. */
const ARTIFACT_VERIFY_MAX_RETRIES = 2;

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
    graph: TaskGraph,
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
      graph,
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
    graph: TaskGraph,
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
        graph,
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
    graph: TaskGraph,
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
    const instruction = this.buildInstruction(task, graph);

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

    const runOptions = {
      runId: subRunId,
      abortSignal: ac.signal,
      deadlineAt,
      maxIterations: maxIter,
    };

    let summary = await subLoop.completeAgentRun(subSessionId, instruction, runOptions);
    let reply = summary.reply;

    if (task.artifactPath) {
      reply = await this.ensureArtifactWritten(
        task,
        parentSessionId,
        subSessionId,
        subLoop,
        runOptions,
        reply,
      );
    }

    logger.info(
      `[WorkerPool] Task "${task.id}" completed with outcome: ${summary.outcome}`,
    );

    return reply;
  }

  /**
   * Verifies the task artifact exists on disk. Nudges the same sub-agent to create it if missing.
   */
  private async ensureArtifactWritten(
    task: TaskNode,
    parentSessionId: string,
    subSessionId: string,
    subLoop: AgentLoop,
    runOptions: {
      runId: string;
      abortSignal: AbortSignal;
      deadlineAt: number;
      maxIterations: number;
    },
    lastReply: string,
  ): Promise<string> {
    const artifactPath = task.artifactPath!;
    const rel = normalizeWorkspaceRelativePath(artifactPath);

    if (
      await sessionArtifactExists(
        DEFAULT_WORKSPACE_BASE,
        parentSessionId,
        artifactPath,
      )
    ) {
      return lastReply;
    }

    let reply = lastReply;
    for (let attempt = 1; attempt <= ARTIFACT_VERIFY_MAX_RETRIES; attempt++) {
      logger.warn(
        `[WorkerPool] Task "${task.id}" missing artifact at ${rel}, retry ${attempt}/${ARTIFACT_VERIFY_MAX_RETRIES}`,
      );

      const retrySummary = await subLoop.completeAgentRun(
        subSessionId,
        this.buildArtifactRetryMessage(rel),
        runOptions,
      );
      reply = retrySummary.reply;

      if (
        await sessionArtifactExists(
          DEFAULT_WORKSPACE_BASE,
          parentSessionId,
          artifactPath,
        )
      ) {
        return reply;
      }
    }

    throw new Error(
      `Required artifact not found at \`${rel}\` after ${ARTIFACT_VERIFY_MAX_RETRIES + 1} attempt(s). ` +
        "The task must persist the full output at that path (any file type) before completing.",
    );
  }

  private buildArtifactRetryMessage(relPath: string): string {
    return [
      `Required artifact is missing at: \`${relPath}\``,
      "",
      "Persist the complete output at that exact path before finishing.",
      "Use write_file for text/JSON/CSV and other allowed tools for binary outputs when needed.",
      "After the file exists on disk, respond with a brief confirmation.",
    ].join("\n");
  }

  private buildInstruction(task: TaskNode, graph: TaskGraph): string {
    const lines: string[] = [];

    const upstream = this.formatUpstreamDependencies(task, graph);
    if (upstream.length > 0) {
      lines.push(...upstream, "");
    }

    lines.push(`## Task: ${task.title}`, "", task.instruction);

    if (task.artifactPath) {
      const outPath = normalizeWorkspaceRelativePath(task.artifactPath);
      lines.push(
        "",
        `Primary artifact path: ${outPath}`,
        "Persist your complete output there (any file extension).",
        "Use write_file for text/JSON/CSV, or another allowed tool when the output is binary.",
        "Do not finish until that path exists as a non-empty file.",
      );
    }

    lines.push(
      "",
      "When finished, respond with a concise summary of your findings.",
    );

    return lines.join("\n");
  }

  /** Inject completed dependency artifact paths and summaries for downstream workers. */
  private formatUpstreamDependencies(task: TaskNode, graph: TaskGraph): string[] {
    if (task.depends_on.length === 0) {
      return [];
    }

    const lines: string[] = [
      "## Upstream dependencies (completed)",
      "",
      "These tasks finished before yours. Open each artifact below with read_file (or list_directory) before executing your task.",
      "",
    ];

    for (const depId of task.depends_on) {
      const dep = graph.getNode(depId);
      if (!dep) {
        lines.push(`### ${depId}`, "- (dependency not found in graph)", "");
        continue;
      }

      const heading = dep.title ? `${dep.id} — ${dep.title}` : dep.id;
      lines.push(`### ${heading}`);

      if (dep.artifactPath) {
        const rel = normalizeWorkspaceRelativePath(dep.artifactPath);
        lines.push(`- **Artifact path:** \`${rel}\``);
      }

      if (dep.result?.trim()) {
        const text = dep.result.trim();
        const preview =
          text.length > UPSTREAM_SUMMARY_MAX_CHARS
            ? `${text.slice(0, UPSTREAM_SUMMARY_MAX_CHARS)}…`
            : text;
        lines.push(`- **Upstream summary:** ${preview}`);
      } else if (!dep.artifactPath) {
        lines.push("- **Upstream summary:** (no artifact file or summary recorded)");
      }

      lines.push("");
    }

    return lines;
  }
}
