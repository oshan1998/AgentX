/**
 * Agent run trace events — payloads are broadcast over WebSocket as `{ type: "agent_trace", payload }`.
 * Mirror in AgentX-Frontend/src/realtime/protocol.ts
 */

export type AgentTraceStep =
  | { step: "thought"; iteration: number; phase: "start" | "end"; text?: string }
  | { step: "tool"; iteration: number; name: string; phase: "start" | "end" }
  | { step: "skill"; iteration: number; name: string; phase: "start" | "end" }
  | { step: "skill_tool"; iteration: number; skill: string; tool: string; phase: "start" | "end" }
  | { step: "memory_write"; iteration: number; phase: "start" | "end" }
  | { step: "profile_write"; iteration: number; phase: "start" | "end"; target?: string }
  | { step: "run_done"; outcome: "complete" | "max_iterations" };

export type AgentTracePayload = { sessionId: string; runId: string; seq: number; ts: string } & AgentTraceStep;

export interface RunTracer {
  /** `text` applies to `phase: "end"` (model thought); omit on start */
  thought(iteration: number, phase: "start" | "end", text?: string): void;
  tool(iteration: number, name: string, phase: "start" | "end"): void;
  skill(iteration: number, name: string, phase: "start" | "end"): void;
  skillTool(iteration: number, skill: string, tool: string, phase: "start" | "end"): void;
  memoryWrite(iteration: number, phase: "start" | "end"): void;
  profileWrite(iteration: number, phase: "start" | "end", target?: string): void;
  runDone(outcome: "complete" | "max_iterations"): void;
}
