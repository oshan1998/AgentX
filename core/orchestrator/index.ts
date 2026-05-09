/**
 * Orchestrator module — DAG-based parallel task execution.
 *
 * Usage:
 * ```ts
 * import { Orchestrator, type TaskGraphConfig } from "./orchestrator/index.js";
 * ```
 */
export { Orchestrator, type OrchestratorDeps, type OrchestratorConfig, type OrchestrateInput, type OrchestrateResult } from "./orchestrator.js";
export { TaskGraph, TaskNodeStatus, type TaskNode, type TaskGraphConfig } from "./task-graph.js";
export { Scheduler, type SchedulerConfig, type SchedulerResult } from "./scheduler.js";
export { WorkerPool, type WorkerPoolDeps, type WorkerPoolConfig } from "./worker-pool.js";
export { OrchestratorEventBus, type OrchestratorEventMap, type TaskStartedEvent, type TaskCompletedEvent, type TaskFailedEvent, type GraphDoneEvent } from "./event-bus.js";
