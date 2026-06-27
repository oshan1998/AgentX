import { WebSocket } from "ws";
import type { AgentTracePayload, AgentTraceStep, RunTracer } from "./agent-trace-types.js";
import { logger } from "../services/logger.js";
import { AgentTracePhase } from "./agent-trace-types.js";
const OPEN = WebSocket.OPEN;

/**
 * Tracks which sockets want trace events per session and broadcasts payloads.
 * Sequencing is per (sessionId, runId); all run steps use this hub so delegation can interleave coherently.
 */
export class SessionTraceHub {
  private readonly sessionSockets = new Map<string, Set<WebSocket>>();
  private readonly socketSessions = new Map<WebSocket, Set<string>>();
  private readonly seqByRun = new Map<string, number>();

  private seqKey(sessionId: string, runId: string): string {
    return `${sessionId}\u0000${runId}`;
  }

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

  broadcastTrace(payload: AgentTracePayload): void {
    // Sub-agent runs use a child session id (`rootId::sub_<uuid>`), but clients
    // only ever subscribe to the root session. Deliver to both the exact-session
    // subscribers and the root-session subscribers so delegated traces surface.
    const rootSessionId = payload.sessionId.split("::")[0];

    const targets = new Set<WebSocket>();
    for (const ws of this.sessionSockets.get(payload.sessionId) ?? []) {
      targets.add(ws);
    }
    if (rootSessionId !== payload.sessionId) {
      for (const ws of this.sessionSockets.get(rootSessionId) ?? []) {
        targets.add(ws);
      }
    }
    if (!targets.size) return;

    const frame = JSON.stringify({ type: "agent_trace", payload });

    for (const ws of targets) {
      if (ws.readyState === OPEN) {
        ws.send(frame);
      }
    }
  }

  emitTraceStep(sessionId: string, runId: string, fragment: AgentTraceStep): void {
    const k = this.seqKey(sessionId, runId);
    const seq = (this.seqByRun.get(k) ?? 0) + 1;
    this.seqByRun.set(k, seq);
    const payload: AgentTracePayload = {
      sessionId,
      runId,
      seq,
      ts: new Date().toISOString(),
      ...fragment,
    };
    this.broadcastTrace(payload);
  }

  createRunTracer(sessionId: string, runId: string): RunTracer {
    const emitFrag = (fragment: AgentTraceStep): void => {
      this.emitTraceStep(sessionId, runId, fragment);
    };

    return {
      thought(iteration: number, phase: AgentTracePhase, text?: string): void {
        emitFrag({
          step: "thought",
          iteration,
          phase,
          ...(text !== undefined ? { text } : {}),
        });
      },
      tool(iteration: number, name: string, phase: AgentTracePhase): void {
        emitFrag({ step: "tool", iteration, name, phase });
      },
      skill(iteration: number, name: string, phase: AgentTracePhase): void {
        emitFrag({ step: "skill", iteration, name, phase });
      },
      skillTool(
        iteration: number,
        skill: string,
        tool: string,
        phase: AgentTracePhase,
      ): void {
        emitFrag({ step: "skill_tool", iteration, skill, tool, phase });
      },
      memoryWrite(iteration: number, phase: AgentTracePhase): void {
        emitFrag({ step: "memory_write", iteration, phase });
      },
      profileWrite(iteration: number, phase: AgentTracePhase, target?: string): void {
        emitFrag({ step: "profile_write", iteration, phase, target });
      },
      runDone(outcome): void {
        emitFrag({ step: "run_done", outcome });
      },
    };
  }
}
