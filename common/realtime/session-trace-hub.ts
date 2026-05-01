import { WebSocket } from "ws";
import { logger } from "../services/logger.js";
import type { AgentTracePayload, AgentTraceStep, RunTracer } from "./agent-trace-types.js";

const OPEN = WebSocket.OPEN;

/**
 * Tracks which sockets want trace events per session and broadcasts payloads.
 */
export class SessionTraceHub {
  private readonly sessionSockets = new Map<string, Set<WebSocket>>();
  private readonly socketSessions = new Map<WebSocket, Set<string>>();

  subscribe(socket: WebSocket, sessionId: string): void {
    if (!sessionId) return;

    let set = this.sessionSockets.get(sessionId);
    if (!set) {
      set = new Set();
      this.sessionSockets.set(sessionId, set);
    }
    set.add(socket);

    let subs = this.socketSessions.get(socket);
    if (!subs) {
      subs = new Set();
      this.socketSessions.set(socket, subs);
    }
    subs.add(sessionId);

    logger.debug("WebSocket subscribe trace", { sessionId });
  }

  unsubscribe(socket: WebSocket, sessionId: string): void {
    const set = this.sessionSockets.get(sessionId);
    if (set) {
      set.delete(socket);
      if (set.size === 0) this.sessionSockets.delete(sessionId);
    }
    const subs = this.socketSessions.get(socket);
    if (subs) {
      subs.delete(sessionId);
      if (subs.size === 0) this.socketSessions.delete(socket);
    }
    logger.debug("WebSocket unsubscribe trace", { sessionId });
  }

  removeSocket(socket: WebSocket): void {
    const subs = this.socketSessions.get(socket);
    if (!subs) return;
    for (const sessionId of subs) {
      const set = this.sessionSockets.get(sessionId);
      if (set) {
        set.delete(socket);
        if (set.size === 0) this.sessionSockets.delete(sessionId);
      }
    }
    this.socketSessions.delete(socket);
  }

  emitTrace(trace: AgentTracePayload): void {
    const set = this.sessionSockets.get(trace.sessionId);
    if (!set?.size) return;

    const frame = JSON.stringify({ type: "agent_trace", payload: trace });

    for (const ws of set) {
      if (ws.readyState === OPEN) {
        ws.send(frame);
      }
    }
  }

  createRunTracer(sessionId: string, runId: string): RunTracer {
    let seq = 0;
    const emit = (step: AgentTraceStep): void => {
      const payload: AgentTracePayload = {
        sessionId,
        runId,
        seq: (seq += 1),
        ts: new Date().toISOString(),
        ...step,
      };
      this.emitTrace(payload);
    };

    return {
      thought(iteration: number, phase: "start" | "end", text?: string): void {
        emit({ step: "thought", iteration, phase, ...(text !== undefined ? { text } : {}) });
      },
      tool(iteration: number, name: string, phase: "start" | "end"): void {
        emit({ step: "tool", iteration, name, phase });
      },
      skill(iteration: number, name: string, phase: "start" | "end"): void {
        emit({ step: "skill", iteration, name, phase });
      },
      skillTool(iteration: number, skill: string, tool: string, phase: "start" | "end"): void {
        emit({ step: "skill_tool", iteration, skill, tool, phase });
      },
      memoryWrite(iteration: number, phase: "start" | "end"): void {
        emit({ step: "memory_write", iteration, phase });
      },
      profileWrite(iteration: number, phase: "start" | "end", target?: string): void {
        emit({ step: "profile_write", iteration, phase, target });
      },
      runDone(outcome: "complete" | "max_iterations"): void {
        emit({ step: "run_done", outcome });
      },
    };
  }
}
