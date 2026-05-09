import { logger } from "../../common/services/logger.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export enum TaskNodeStatus {
  Pending = "pending",
  Ready = "ready",
  Running = "running",
  Completed = "completed",
  Failed = "failed",
  Skipped = "skipped",
}

export interface TaskNode {
  /** Stable id from the task plan (e.g. `market_overview`). */
  id: string;
  /** Human-readable title. */
  title: string;
  /** IDs of tasks that must complete before this one can start. */
  depends_on: string[];
  /** The task instruction for the sub-agent. */
  instruction: string;
  /** Tool allow-list for the worker sub-agent. */
  tool_names: string[];
  /** Skill allow-list for the worker sub-agent (optional). */
  skill_names?: string[];
  /** Optional path where the worker should write its output. */
  artifactPath?: string;
  /** Current execution status. */
  status: TaskNodeStatus;
  /** Worker result (populated after completion). */
  result?: string;
  /** Error message (populated after failure). */
  error?: string;
}

export interface TaskGraphConfig {
  /** Objective that produced this graph (for tracing). */
  objective: string;
  nodes: TaskNode[];
}

// ─── Task Graph ──────────────────────────────────────────────────────────────

/**
 * Immutable-ish DAG: status transitions are guarded.
 * The scheduler queries `getReadyTasks()` each time a task completes or at init.
 */
export class TaskGraph {
  readonly objective: string;
  private readonly nodes: Map<string, TaskNode>;
  private readonly dependents: Map<string, Set<string>>;

  constructor(config: TaskGraphConfig) {
    this.objective = config.objective;
    this.nodes = new Map();
    this.dependents = new Map();

    for (const node of config.nodes) {
      this.nodes.set(node.id, { ...node });
    }

    this.buildDependentsIndex();
    this.validate();
    this.initializeReady();
  }

  // ── Queries ──────────────────────────────────────────────────────────────

  getNode(id: string): TaskNode | undefined {
    return this.nodes.get(id);
  }

  getAllNodes(): TaskNode[] {
    return [...this.nodes.values()];
  }

  /** Tasks whose dependencies are all completed and status is `ready`. */
  getReadyTasks(): TaskNode[] {
    return [...this.nodes.values()].filter(
      (n) => n.status === TaskNodeStatus.Ready,
    );
  }

  /** True when every node is in a terminal state (completed / failed / skipped). */
  isFinished(): boolean {
    return [...this.nodes.values()].every((n) =>
      n.status === TaskNodeStatus.Completed ||
      n.status === TaskNodeStatus.Failed ||
      n.status === TaskNodeStatus.Skipped,
    );
  }

  getCompletedCount(): number {
    return [...this.nodes.values()].filter(
      (n) => n.status === TaskNodeStatus.Completed,
    ).length;
  }

  getFailedCount(): number {
    return [...this.nodes.values()].filter(
      (n) => n.status === TaskNodeStatus.Failed,
    ).length;
  }

  /** Collect results from all completed tasks as a record. */
  getResults(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const n of this.nodes.values()) {
      if (n.status === TaskNodeStatus.Completed && n.result) {
        out[n.id] = n.result;
      }
    }
    return out;
  }

  // ── Mutations (guarded) ──────────────────────────────────────────────────

  markRunning(id: string): void {
    const node = this.mustGet(id);
    if (node.status !== TaskNodeStatus.Ready) {
      throw new Error(
        `Cannot start task "${id}": status is "${node.status}", expected "ready".`,
      );
    }
    node.status = TaskNodeStatus.Running;
  }

  markCompleted(id: string, result: string): void {
    const node = this.mustGet(id);
    if (node.status !== TaskNodeStatus.Running) {
      throw new Error(
        `Cannot complete task "${id}": status is "${node.status}", expected "running".`,
      );
    }
    node.status = TaskNodeStatus.Completed;
    node.result = result;
    this.promoteNewlyReady(id);
  }

  markFailed(id: string, error: string): void {
    const node = this.mustGet(id);
    if (node.status !== TaskNodeStatus.Running) {
      throw new Error(
        `Cannot fail task "${id}": status is "${node.status}", expected "running".`,
      );
    }
    node.status = TaskNodeStatus.Failed;
    node.error = error;
    this.skipDependents(id);
  }

  // ── Internal helpers ─────────────────────────────────────────────────────

  private mustGet(id: string): TaskNode {
    const n = this.nodes.get(id);
    if (!n) throw new Error(`Task "${id}" not found in graph.`);
    return n;
  }

  /** Build a reverse index: for each task, which tasks depend on it. */
  private buildDependentsIndex(): void {
    for (const node of this.nodes.values()) {
      for (const dep of node.depends_on) {
        let set = this.dependents.get(dep);
        if (!set) {
          set = new Set();
          this.dependents.set(dep, set);
        }
        set.add(node.id);
      }
    }
  }

  /** Mark pending nodes as ready if all their dependencies are already met. */
  private initializeReady(): void {
    for (const node of this.nodes.values()) {
      if (
        node.status === TaskNodeStatus.Pending &&
        this.allDependenciesMet(node)
      ) {
        node.status = TaskNodeStatus.Ready;
      }
    }
  }

  /** After a task completes, check its dependents — promote newly unblocked ones to ready. */
  private promoteNewlyReady(completedId: string): void {
    const deps = this.dependents.get(completedId);
    if (!deps) return;

    for (const depId of deps) {
      const depNode = this.nodes.get(depId);
      if (
        depNode &&
        depNode.status === TaskNodeStatus.Pending &&
        this.allDependenciesMet(depNode)
      ) {
        depNode.status = TaskNodeStatus.Ready;
        logger.debug(`[TaskGraph] Task "${depId}" is now ready.`);
      }
    }
  }

  /** If a task fails, skip everything that transitively depends on it. */
  private skipDependents(failedId: string): void {
    const queue = [failedId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const deps = this.dependents.get(current);
      if (!deps) continue;

      for (const depId of deps) {
        const depNode = this.nodes.get(depId);
        if (
          depNode &&
          (depNode.status === TaskNodeStatus.Pending ||
            depNode.status === TaskNodeStatus.Ready)
        ) {
          depNode.status = TaskNodeStatus.Skipped;
          depNode.error = `Skipped: upstream task "${failedId}" failed.`;
          logger.warn(`[TaskGraph] Task "${depId}" skipped due to failure of "${failedId}".`);
          queue.push(depId);
        }
      }
    }
  }

  private allDependenciesMet(node: TaskNode): boolean {
    return node.depends_on.every((depId) => {
      const dep = this.nodes.get(depId);
      return dep?.status === TaskNodeStatus.Completed;
    });
  }

  /** Validate DAG: check for missing references and cycles. */
  private validate(): void {
    // Check for missing dependency references
    for (const node of this.nodes.values()) {
      for (const dep of node.depends_on) {
        if (!this.nodes.has(dep)) {
          throw new Error(
            `Task "${node.id}" depends on "${dep}" which does not exist in the graph.`,
          );
        }
      }
    }

    // Simple cycle detection via topological sort (Kahn's algorithm)
    const inDegree = new Map<string, number>();
    for (const node of this.nodes.values()) {
      if (!inDegree.has(node.id)) inDegree.set(node.id, 0);
      for (const dep of node.depends_on) {
        inDegree.set(node.id, (inDegree.get(node.id) ?? 0) + 1);
      }
    }

    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    let visited = 0;
    while (queue.length > 0) {
      const current = queue.shift()!;
      visited++;
      const deps = this.dependents.get(current);
      if (!deps) continue;
      for (const depId of deps) {
        const newDeg = (inDegree.get(depId) ?? 1) - 1;
        inDegree.set(depId, newDeg);
        if (newDeg === 0) queue.push(depId);
      }
    }

    if (visited !== this.nodes.size) {
      throw new Error(
        `Task graph contains a cycle. Visited ${visited}/${this.nodes.size} nodes.`,
      );
    }
  }
}
