/**
 * WebSocket JSON envelope — keep in sync with AgentX-Frontend/src/realtime/protocol.ts
 */

import type { AgentTracePayload } from "./agent-trace-types.js";

export type ClientMessage =
  | { type: "hello"; payload?: { clientVersion?: string } }
  | { type: "ping"; payload?: { t?: number } }
  | { type: "subscribe"; payload: { sessionId: string } }
  | { type: "unsubscribe"; payload: { sessionId: string } };

export type ServerMessage =
  | { type: "welcome"; payload: { serverTime: string } }
  | { type: "pong"; payload: { t: number } }
  | { type: "error"; payload: { code: string; message?: string } }
  | { type: "agent_trace"; payload: AgentTracePayload };

export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const type = o.type;
  if (type === "hello") {
    const p = o.payload;
    if (p !== undefined && (typeof p !== "object" || p === null)) return null;
    const payload = p as Record<string, unknown> | undefined;
    return {
      type: "hello",
      payload: payload
        ? { clientVersion: typeof payload.clientVersion === "string" ? payload.clientVersion : undefined }
        : undefined,
    };
  }
  if (type === "ping") {
    const p = o.payload;
    if (p !== undefined && (typeof p !== "object" || p === null)) return null;
    const payload = p as Record<string, unknown> | undefined;
    return {
      type: "ping",
      payload: payload
        ? { t: typeof payload.t === "number" ? payload.t : undefined }
        : undefined,
    };
  }
  if (type === "subscribe" || type === "unsubscribe") {
    const p = o.payload;
    if (typeof p !== "object" || p === null) return null;
    const sessionId = (p as Record<string, unknown>).sessionId;
    if (typeof sessionId !== "string" || sessionId.length === 0) return null;
    return type === "subscribe"
      ? { type: "subscribe", payload: { sessionId } }
      : { type: "unsubscribe", payload: { sessionId } };
  }
  return null;
}

export function sendJson(ws: { send: (data: string) => void }, msg: ServerMessage): void {
  ws.send(JSON.stringify(msg));
}
