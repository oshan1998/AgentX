import { EventEmitter } from "node:events";
import { logger } from "../../common/services/logger.js";

// ─── Event types ─────────────────────────────────────────────────────────────

export interface TaskStartedEvent {
  taskId: string;
  workerId: number;
  ts: string;
}

export interface TaskCompletedEvent {
  taskId: string;
  workerId: number;
  result: string;
  ts: string;
}

export interface TaskFailedEvent {
  taskId: string;
  workerId: number;
  error: string;
  ts: string;
}

export interface GraphDoneEvent {
  completedCount: number;
  failedCount: number;
  ts: string;
}

export interface OrchestratorEventMap {
  task_started: [TaskStartedEvent];
  task_completed: [TaskCompletedEvent];
  task_failed: [TaskFailedEvent];
  graph_done: [GraphDoneEvent];
}

// ─── Typed Event Bus ─────────────────────────────────────────────────────────

/**
 * Thin typed wrapper around Node EventEmitter.
 * Keeps orchestrator components decoupled — the scheduler doesn't know
 * about the worker pool and vice-versa; they communicate through events.
 */
export class OrchestratorEventBus {
  private readonly emitter = new EventEmitter();

  on<K extends keyof OrchestratorEventMap>(
    event: K,
    listener: (...args: OrchestratorEventMap[K]) => void,
  ): void {
    this.emitter.on(event, listener as (...args: unknown[]) => void);
  }

  once<K extends keyof OrchestratorEventMap>(
    event: K,
    listener: (...args: OrchestratorEventMap[K]) => void,
  ): void {
    this.emitter.once(event, listener as (...args: unknown[]) => void);
  }

  emit<K extends keyof OrchestratorEventMap>(
    event: K,
    ...args: OrchestratorEventMap[K]
  ): void {
    logger.debug(`[EventBus] ${event}`, args[0]);
    this.emitter.emit(event, ...args);
  }

  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }
}
