/**
 * Agent run trace events — payloads are broadcast over WebSocket as `{ type: "agent_trace", payload }`.
 * Mirror in AgentX-Frontend/src/realtime/protocol.ts
 */

export enum AgentTracePhase {
  START = "start",
  END = "end",
}

export enum AgentRunOutcome {
  COMPLETE = "complete",
  MAX_ITERATIONS = "max_iterations",
  CANCELLED = "cancelled",
  TIMED_OUT = "timed_out",
}

export type AgentTraceRunOutcome =
  | AgentRunOutcome.COMPLETE
  | AgentRunOutcome.MAX_ITERATIONS
  | AgentRunOutcome.CANCELLED
  | AgentRunOutcome.TIMED_OUT;

export type AgentTraceStep =
  | { step: "thought"; iteration: number; phase: AgentTracePhase.START | AgentTracePhase.END; text?: string }
  | { step: "tool"; iteration: number; name: string; phase: AgentTracePhase.START | AgentTracePhase.END }
  | { step: "skill"; iteration: number; name: string; phase: AgentTracePhase.START | AgentTracePhase.END }
  | { step: "skill_tool"; iteration: number; skill: string; tool: string; phase: AgentTracePhase.START | AgentTracePhase.END }
  | { step: "memory_write"; iteration: number; phase: AgentTracePhase.START | AgentTracePhase.END }
  | { step: "profile_write"; iteration: number; phase: AgentTracePhase.START | AgentTracePhase.END; target?: string }
  | {
      step: "sub_delegate";
      phase: AgentTracePhase.START | AgentTracePhase.END;
      /** Parent iteration when this synthetic step attaches to a host run trace. */
      iteration: number;
      subSessionId: string;
      subRunId: string;
      outcome?: AgentTraceRunOutcome;
    }
  | { step: "run_done"; outcome: AgentTraceRunOutcome };

export type AgentTracePayload = { sessionId: string; runId: string; seq: number; ts: string } & AgentTraceStep;

export interface RunTracer {
  /** `text` applies to `phase: "end"` (model thought); omit on start */
  thought(iteration: number, phase: AgentTracePhase, text?: string): void;
  tool(iteration: number, name: string, phase: AgentTracePhase): void;
  skill(iteration: number, name: string, phase: AgentTracePhase): void;
  skillTool(iteration: number, skill: string, tool: string, phase: AgentTracePhase): void;
  memoryWrite(iteration: number, phase: AgentTracePhase): void;
  profileWrite(iteration: number, phase: AgentTracePhase, target?: string): void;
  runDone(outcome: AgentTraceRunOutcome): void;
}
