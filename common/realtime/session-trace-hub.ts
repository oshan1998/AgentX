import { WebSocket } from "ws";
import type { AgentTracePayload, AgentTraceStep, RunTracer } from "./agent-trace-types.js";
import { logger } from "../services/logger.js";
import { AgentTracePhase } from "./agent-trace-types.js";
const OPEN = WebSocket.OPEN;

/** Recent trace payloads replayed to clients that subscribe after a run starts. */
const TRACE_REPLAY_LIMIT = 250;

/**
 * Tracks which sockets want trace events per session and broadcasts payloads.
 * Sequencing is per (sessionId, runId); all run steps use this hub so delegation can interleave coherently.
 */
export class SessionTraceHub {
  private readonly sessionSockets = new Map<string, Set<WebSocket>>();
  private readonly socketSessions = new Map<WebSocket, Set<string>>();
  private readonly seqByRun = new Map<string, number>();
  private readonly replayBySession = new Map<string, AgentTracePayload[]>();

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

    this.replayRecentTraces(socket, sessionId);

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

  private parentSessionId(sessionId: string): string | undefined {
    const subIdx = sessionId.indexOf("::sub_");
    return subIdx > 0 ? sessionId.slice(0, subIdx) : undefined;
  }

  private traceMatchesSubscription(
    payload: AgentTracePayload,
    subscribedSessionId: string,
  ): boolean {
    if (payload.sessionId === subscribedSessionId) return true;
    return payload.sessionId.startsWith(`${subscribedSessionId}::sub_`);
  }

  private rememberTrace(payload: AgentTracePayload): void {
    const keys = new Set<string>([payload.sessionId]);
    const parentId = this.parentSessionId(payload.sessionId);
    if (parentId) keys.add(parentId);

    for (const key of keys) {
      let buffer = this.replayBySession.get(key);
      if (!buffer) {
        buffer = [];
        this.replayBySession.set(key, buffer);
      }
      buffer.push(payload);
      if (buffer.length > TRACE_REPLAY_LIMIT) {
        buffer.splice(0, buffer.length - TRACE_REPLAY_LIMIT);
      }
    }
  }

  private sendTraceFrame(socket: WebSocket, payload: AgentTracePayload): void {
    if (socket.readyState !== OPEN) return;
    socket.send(JSON.stringify({ type: "agent_trace", payload }));
  }

  private replayRecentTraces(socket: WebSocket, subscribedSessionId: string): void {
    const buffer = this.replayBySession.get(subscribedSessionId);
    if (!buffer?.length) return;

    for (const payload of buffer) {
      if (!this.traceMatchesSubscription(payload, subscribedSessionId)) continue;
      this.sendTraceFrame(socket, payload);
    }
  }

  broadcastTrace(payload: AgentTracePayload): void {
    const recipients = new Set<WebSocket>();

    const exact = this.sessionSockets.get(payload.sessionId);
    if (exact) {
      for (const ws of exact) recipients.add(ws);
    }

    const parentId = this.parentSessionId(payload.sessionId);
    if (parentId) {
      const parentSubs = this.sessionSockets.get(parentId);
      if (parentSubs) {
        for (const ws of parentSubs) recipients.add(ws);
      }
    }

    if (recipients.size === 0) return;

    const frame = JSON.stringify({ type: "agent_trace", payload });
    for (const ws of recipients) {
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
    this.rememberTrace(payload);
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
      tool(iteration: number, name: string, phase: AgentTracePhase, meta): void {
        emitFrag({ step: "tool", iteration, name, phase, ...(meta ?? {}) });
      },
      skill(iteration: number, name: string, phase: AgentTracePhase): void {
        emitFrag({ step: "skill", iteration, name, phase });
      },
      skillTool(
        iteration: number,
        skill: string,
        tool: string,
        phase: AgentTracePhase,
        meta,
      ): void {
        emitFrag({ step: "skill_tool", iteration, skill, tool, phase, ...(meta ?? {}) });
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
