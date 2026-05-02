import type { SkillRegistry, ToolRegistry } from "../common/interfaces/registry.js";
import {
  DecisionType,
  type AgentDecision,
  type LlmAdapter,
  type Message,
} from "../common/interfaces/types.js";
import type { SessionTraceHub } from "../common/realtime/session-trace-hub.js";
import { AgentRunOutcome, AgentTracePhase, type AgentTraceRunOutcome } from "../common/realtime/agent-trace-types.js";
import { Executor } from "./executor.js";
import type { ExecutorInvocationContext, ExecutorTraceContext } from "./executor.js";
import {
  PRIMARY_AGENT_EXECUTION_POLICY,
  type ExecutionPolicy,
} from "./execution-policy.js";
import { MemoryManager } from "../managers/memory-manager.js";
import { PromptBuilder } from "./prompt-builder.js";
import { ProfileManager } from "../managers/profile-manager.js";
import { logger } from "../common/services/logger.js";

export interface AgentRunHandleOptions {
  runId?: string;
  abortSignal?: AbortSignal;
  deadlineAt?: number;
  /** Per-handle cap bounded by AgentLoop constructed maxIterations. */
  maxIterations?: number;
}

export interface AgentRunSummary {
  reply: string;
  outcome: AgentTraceRunOutcome;
}
export enum AgentType {
  Primary = "primary",
  SubAgent = "sub_agent",
}

interface AgentLoopDependencies {
  llm: LlmAdapter;
  memoryManager: MemoryManager;
  profileManager: ProfileManager;
  toolRegistry: ToolRegistry;
  skillRegistry: SkillRegistry;
  maxIterations?: number;
  sessionTraceHub?: SessionTraceHub;
  executionPolicy?: ExecutionPolicy;
  agentType: AgentType;
}

export class AgentLoop {
  private readonly promptBuilder = new PromptBuilder();
  private readonly executor: Executor;
  private readonly maxIterations: number;

  constructor(private readonly deps: AgentLoopDependencies) {
    const policy = deps.executionPolicy ?? PRIMARY_AGENT_EXECUTION_POLICY;
    this.executor = new Executor(
      deps.memoryManager,
      deps.profileManager,
      deps.toolRegistry,
      deps.skillRegistry,
      policy,
    );
    this.maxIterations = deps.maxIterations ?? 50;
  }

  async handleUserInput(
    sessionId: string,
    userInput: string,
    options?: AgentRunHandleOptions,
  ): Promise<string> {
    const { reply } = await this.completeAgentRun(sessionId, userInput, options);
    return reply;
  }

  async completeAgentRun(
    sessionId: string,
    userInput: string,
    options?: AgentRunHandleOptions,
  ): Promise<AgentRunSummary> {
    const isSubAgent = this.deps.agentType === AgentType.SubAgent;
    logger.info(`Handling user input for session ${sessionId}`, {
      userInput,
      isSubAgent,
    });

    await this.deps.memoryManager.appendSessionMessage(
      sessionId,
      this.message("user", userInput),
    );

    const tracer =
      options?.runId && this.deps.sessionTraceHub
        ? this.deps.sessionTraceHub.createRunTracer(sessionId, options.runId)
        : undefined;

    let lastObservation: string | undefined;

    const iterCap =
      options?.maxIterations !== undefined
        ? Math.max(1, Math.min(options.maxIterations, this.maxIterations))
        : this.maxIterations;

    let outcome: AgentTraceRunOutcome = AgentRunOutcome.COMPLETE;

    const invocation: ExecutorInvocationContext = {
      runId: options?.runId,
      abortSignal: options?.abortSignal,
    };

    for (let i = 0; i < iterCap; i += 1) {
      const iteration = i + 1;

      if (options?.abortSignal?.aborted) {
        outcome = AgentRunOutcome.CANCELLED;
        const msg =
          isSubAgent
            ? "Sub-agent task was cancelled — report partial findings to principal."
            : "This run was cancelled before completion.";
        tracer?.runDone(outcome);
        await this.deps.memoryManager.appendSessionMessage(
          sessionId,
          this.message("assistant", msg),
        );
        return { reply: msg, outcome };
      }

      if (
        typeof options?.deadlineAt === "number" &&
        Number.isFinite(options.deadlineAt) &&
        Date.now() > options.deadlineAt
      ) {
        outcome = AgentRunOutcome.TIMED_OUT;
        const msg =
          isSubAgent
            ? "Sub-agent task hit its time budget — summarize progress for principal."
            : "This run stopped because its time budget was exceeded.";
        tracer?.runDone(outcome);
        await this.deps.memoryManager.appendSessionMessage(
          sessionId,
          this.message("assistant", msg),
        );
        return { reply: msg, outcome };
      }

      let thoughtOpen = false;
      const traceCtx: ExecutorTraceContext | undefined = tracer
        ? { iteration, tracer }
        : undefined;

      try {
        const session = await this.deps.memoryManager.getSession(sessionId);

        const allMemory = await this.deps.memoryManager.getLongTermMemory();
        const isBootstrapComplete = isSubAgent
          ? true
          : allMemory.some((m) => m.content === "bootstrap_complete");

        const relevantLongTermMemory =
          await this.deps.memoryManager.searchLongTermMemory(userInput);

        const soul = await this.deps.profileManager.getSoul();
        const user = await this.deps.profileManager.getUser();

        const { systemPrompt, userPrompt } = this.promptBuilder.build({
          latestUserMessage: userInput,
          session,
          relevantLongTermMemory,
          soul,
          user,
          toolRegistry: this.deps.toolRegistry,
          skillRegistry: this.deps.skillRegistry,
          lastObservation,
          iteration: i + 1,
          maxIterations: iterCap,
          isBootstrapComplete,
          isSubAgent,
        });

        tracer?.thought(iteration, AgentTracePhase.START);
        thoughtOpen = true;

        const decision = await this.deps.llm.decide(userPrompt, systemPrompt);
        logger.info(`Agent Thought: ${decision.thought}`);
        logger.debug("Received decision from LLM", {
          type: decision.type,
          tool: decision.tool,
          skill: decision.skill,
        });

        tracer?.thought(iteration, AgentTracePhase.END, decision.thought ?? "");
        thoughtOpen = false;

        if (decision.type === DecisionType.Respond) {
          const finalMessage = decision.message ?? "";
          logger.info(`Agent responded for session ${sessionId}`, {
            message: finalMessage,
          });

          await this.deps.memoryManager.appendSessionMessage(
            sessionId,
            this.message("assistant", finalMessage),
          );

          outcome = AgentRunOutcome.COMPLETE;
          tracer?.runDone(outcome);

          return { reply: finalMessage, outcome };
        }

        const result = await this.executor.executeDecision(
          sessionId,
          decision,
          traceCtx,
          invocation,
        );
        logger.info(`Executed decision`, {
          type: decision.type,
          tool: decision.tool,
          skill: decision.skill,
        });

        lastObservation = this.formatExecutionFeedback(decision, result);

        await this.deps.memoryManager.appendSessionMessage(
          sessionId,
          this.message("tool", lastObservation),
        );
      } catch (error) {
        if (thoughtOpen) {
          tracer?.thought(
            iteration,
            AgentTracePhase.END,
            error instanceof Error ? error.message : String(error),
          );
          thoughtOpen = false;
        }
        logger.error(
          `Error in agent loop iteration ${i + 1} for session ${sessionId}`,
          { error: error instanceof Error ? error.message : String(error) },
        );
        lastObservation =
          error instanceof Error
            ? `Error: ${error.message}`
            : `Error: ${String(error)}`;

        await this.deps.memoryManager.appendSessionMessage(
          sessionId,
          this.message("tool", lastObservation),
        );
      }
    }

    const fallback =
      isSubAgent
        ? "Could not finalize delegated task — tell the principal what you tried."
        : "I could not finalize a response within iteration limits.";
    logger.warn(`Agent failed to respond within iteration limits for session ${sessionId}`);

    outcome = AgentRunOutcome.MAX_ITERATIONS;
    tracer?.runDone(outcome);

    await this.deps.memoryManager.appendSessionMessage(
      sessionId,
      this.message("assistant", fallback),
    );

    return { reply: fallback, outcome };
  }

  private formatExecutionFeedback(
    decision: AgentDecision,
    result: unknown,
  ): string {
    if (decision.type === DecisionType.ToolCall) {
      return `Tool ${decision.tool} result: ${this.stringify(result)}`;
    }
    if (decision.type === DecisionType.SkillCall) {
      return `Skill ${decision.skill} result: ${this.stringify(result)}`;
    }
    if (decision.type === DecisionType.MemoryWrite) {
      return `Memory write result: ${this.stringify(result)}`;
    }
    if (decision.type === DecisionType.ProfileWrite) {
      return `Profile write result: ${this.stringify(result)}`;
    }
    if (decision.type === DecisionType.Respond) {
      return `Response: ${this.stringify(result)}`;
    }
    return this.stringify(result);
  }

  private stringify(value: unknown): string {
    if (typeof value === "string") {
      return value;
    }
    return JSON.stringify(value, null, 2);
  }

  private message(role: Message["role"], content: string): Message {
    return {
      role,
      content,
      createdAt: new Date().toISOString(),
    };
  }
}
