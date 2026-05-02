import type { SkillRegistry, ToolRegistry } from "../common/interfaces/registry.js";
import {
  DecisionType,
  type AgentDecision,
  type LlmAdapter,
  type Message,
  type SkillDelegateRunner,
} from "../common/interfaces/types.js";
import type { SessionTraceHub } from "../common/realtime/session-trace-hub.js";
import {
  AgentRunOutcome,
  AgentTracePhase,
  type AgentTraceRunOutcome,
} from "../common/realtime/agent-trace-types.js";
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

// ─── Public types ────────────────────────────────────────────────────────────

export interface AgentRunHandleOptions {
  runId?: string;
  abortSignal?: AbortSignal;
  deadlineAt?: number;
  /** Per-handle cap bounded by AgentLoop constructed maxIterations. */
  maxIterations?: number;
  /** Merged into sub-agent system prompt after the base delegate template. */
  subAgentSystemPromptAppend?: string;
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
  skillDelegateRunner?: SkillDelegateRunner;
}

// ─── Internal types ──────────────────────────────────────────────────────────

/**
 * Signals that the loop should stop early and return a given outcome + message.
 * Thrown by abort/deadline checks so the main loop stays uncluttered.
 */
class EarlyExit {
  constructor(
    readonly outcome: AgentTraceRunOutcome,
    readonly message: string,
  ) {}
}

/** Carries the result of one successful iteration. */
interface IterationResult {
  /** Set when the agent produced a final reply and the loop should end. */
  finalReply?: string;
  /** Observation to feed into the next iteration. */
  observation?: string;
}

// ─── Class ───────────────────────────────────────────────────────────────────

export class AgentLoop {
  private readonly promptBuilder = new PromptBuilder();
  private readonly executor: Executor;
  private readonly maxIterations: number;
  /** runId → controller for cooperative cancel (explicit stop or layered with caller signal). */
  private readonly activeRunControllers = new Map<string, AbortController>();

  constructor(private readonly deps: AgentLoopDependencies) {
    const policy = deps.executionPolicy ?? PRIMARY_AGENT_EXECUTION_POLICY;
    this.executor = new Executor(
      deps.memoryManager,
      deps.profileManager,
      deps.toolRegistry,
      deps.skillRegistry,
      policy,
      deps.skillDelegateRunner,
    );
    this.maxIterations = deps.maxIterations ?? 50;
  }

  /**
   * Abort an in-flight run registered under `runId` (e.g. from POST /api/chat/cancel).
   * Returns false if no active run matches.
   */
  cancelRun(runId: string): boolean {
    const ac = this.activeRunControllers.get(runId);
    if (!ac) return false;
    ac.abort();
    return true;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

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
    logger.info(`Handling user input for session ${sessionId}`, { userInput, isSubAgent });

    await this.deps.memoryManager.appendSessionMessage(
      sessionId,
      AgentLoop.message("user", userInput),
    );

    const tracer =
      options?.runId && this.deps.sessionTraceHub
        ? this.deps.sessionTraceHub.createRunTracer(sessionId, options.runId)
        : undefined;

    /** Options with `abortSignal` merged via `cancelRun` + optional caller HTTP disconnect signal. */
    let loopHandleOptions = options;

    let registeredRunId: string | undefined;

    if (options?.runId) {
      const cancelAc = new AbortController();
      this.activeRunControllers.set(options.runId, cancelAc);
      registeredRunId = options.runId;
      loopHandleOptions = {
        ...options,
        abortSignal:
          options.abortSignal !== undefined
            ? AbortSignal.any([cancelAc.signal, options.abortSignal])
            : cancelAc.signal,
      };
    }

    try {
      const iterCap = this.resolveIterationCap(options?.maxIterations);
      const invocation: ExecutorInvocationContext = {
        runId: options?.runId,
        abortSignal: loopHandleOptions?.abortSignal,
      };

      let lastObservation: string | undefined;

      for (let i = 0; i < iterCap; i++) {
        const iteration = i + 1;
        const traceCtx: ExecutorTraceContext | undefined = tracer
          ? { iteration, tracer }
          : undefined;

        try {
          this.checkForEarlyExit(loopHandleOptions, isSubAgent);

          const result = await this.runIteration(
            sessionId,
            userInput,
            { iteration, iterCap, isSubAgent, lastObservation, options },
            traceCtx,
            invocation,
          );

          if (result.finalReply !== undefined) {
            tracer?.runDone(AgentRunOutcome.COMPLETE);
            return { reply: result.finalReply, outcome: AgentRunOutcome.COMPLETE };
          }

          lastObservation = result.observation;
        } catch (error) {
          if (error instanceof EarlyExit) {
            tracer?.runDone(error.outcome);
            await this.deps.memoryManager.appendSessionMessage(
              sessionId,
              AgentLoop.message("assistant", error.message),
            );
            return { reply: error.message, outcome: error.outcome };
          }

          lastObservation = this.handleIterationError(sessionId, iteration, error);
          await this.deps.memoryManager.appendSessionMessage(
            sessionId,
            AgentLoop.message("tool", lastObservation),
          );
        }
      }

      return this.buildMaxIterationsOutcome(sessionId, isSubAgent, tracer);
    } finally {
      if (registeredRunId) {
        this.activeRunControllers.delete(registeredRunId);
      }
    }
  }

  // ── Iteration helpers ──────────────────────────────────────────────────────

  /**
   * Runs a single agent iteration: builds the prompt, calls the LLM, and
   * either returns the final reply or executes the chosen tool/skill.
   */
  private async runIteration(
    sessionId: string,
    userInput: string,
    ctx: {
      iteration: number;
      iterCap: number;
      isSubAgent: boolean;
      lastObservation: string | undefined;
      options?: AgentRunHandleOptions;
    },
    traceCtx: ExecutorTraceContext | undefined,
    invocation: ExecutorInvocationContext,
  ): Promise<IterationResult> {
    const { systemPrompt, userPrompt } = await this.buildPrompt(sessionId, userInput, ctx);

    traceCtx?.tracer.thought(ctx.iteration, AgentTracePhase.START);

    let decision: AgentDecision;
    try {
      decision = await this.deps.llm.decide(userPrompt, systemPrompt);
    } catch (error) {
      traceCtx?.tracer.thought(
        ctx.iteration,
        AgentTracePhase.END,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }

    logger.info(`Agent thought: ${decision.thought}`);
    logger.debug("Received decision from LLM", {
      type: decision.type,
      tool: decision.tool,
      skill: decision.skill,
    });

    traceCtx?.tracer.thought(ctx.iteration, AgentTracePhase.END, decision.thought ?? "");

    if (decision.type === DecisionType.Respond) {
      return this.handleRespond(sessionId, decision.message ?? "");
    }

    return this.handleToolOrSkill(sessionId, decision, traceCtx, invocation);
  }

  private async buildPrompt(
    sessionId: string,
    userInput: string,
    ctx: {
      iteration: number;
      iterCap: number;
      isSubAgent: boolean;
      lastObservation: string | undefined;
      options?: AgentRunHandleOptions;
    },
  ) {
    const session = await this.deps.memoryManager.getSession(sessionId);
    const allMemory = await this.deps.memoryManager.getLongTermMemory();
    const relevantLongTermMemory = await this.deps.memoryManager.searchLongTermMemory(userInput);
    const soul = await this.deps.profileManager.getSoul();
    const user = await this.deps.profileManager.getUser();

    const isBootstrapComplete = ctx.isSubAgent
      ? true
      : allMemory.some((m) => m.content === "bootstrap_complete");

    return this.promptBuilder.build({
      latestUserMessage: userInput,
      session,
      relevantLongTermMemory,
      soul,
      user,
      toolRegistry: this.deps.toolRegistry,
      skillRegistry: this.deps.skillRegistry,
      lastObservation: ctx.lastObservation,
      iteration: ctx.iteration,
      maxIterations: ctx.iterCap,
      isBootstrapComplete,
      isSubAgent: ctx.isSubAgent,
      subAgentSystemPromptAppend: ctx.isSubAgent ? ctx.options?.subAgentSystemPromptAppend : undefined,
    });
  }

  private async handleRespond(sessionId: string, finalMessage: string): Promise<IterationResult> {
    logger.info(`Agent responded for session ${sessionId}`, { message: finalMessage });
    await this.deps.memoryManager.appendSessionMessage(
      sessionId,
      AgentLoop.message("assistant", finalMessage),
    );
    return { finalReply: finalMessage };
  }

  private async handleToolOrSkill(
    sessionId: string,
    decision: AgentDecision,
    traceCtx: ExecutorTraceContext | undefined,
    invocation: ExecutorInvocationContext,
  ): Promise<IterationResult> {
    const result = await this.executor.executeDecision(sessionId, decision, traceCtx, invocation);
    logger.info("Executed decision", {
      type: decision.type,
      tool: decision.tool,
      skill: decision.skill,
    });

    const observation = AgentLoop.formatFeedback(decision, result);
    await this.deps.memoryManager.appendSessionMessage(
      sessionId,
      AgentLoop.message("tool", observation),
    );
    return { observation };
  }

  // ── Guard helpers ──────────────────────────────────────────────────────────

  /**
   * Throws `EarlyExit` if the run should stop due to cancellation or deadline.
   * Keeping checks here prevents duplicated branching inside the main loop.
   */
  private checkForEarlyExit(
    options: AgentRunHandleOptions | undefined,
    isSubAgent: boolean,
  ): void {
    if (options?.abortSignal?.aborted) {
      throw new EarlyExit(
        AgentRunOutcome.CANCELLED,
        isSubAgent
          ? "Sub-agent task was cancelled — report partial findings to principal."
          : "This run was cancelled before completion.",
      );
    }

    if (
      typeof options?.deadlineAt === "number" &&
      Number.isFinite(options.deadlineAt) &&
      Date.now() > options.deadlineAt
    ) {
      throw new EarlyExit(
        AgentRunOutcome.TIMED_OUT,
        isSubAgent
          ? "Sub-agent task hit its time budget — summarize progress for principal."
          : "This run stopped because its time budget was exceeded.",
      );
    }
  }

  private handleIterationError(sessionId: string, iteration: number, error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Error in agent loop iteration ${iteration} for session ${sessionId}`, {
      error: message,
    });
    return `Error: ${message}`;
  }

  private async buildMaxIterationsOutcome(
    sessionId: string,
    isSubAgent: boolean,
    tracer: ReturnType<SessionTraceHub["createRunTracer"]> | undefined,
  ): Promise<AgentRunSummary> {
    logger.warn(`Agent failed to respond within iteration limits for session ${sessionId}`);

    const reply = isSubAgent
      ? "Could not finalize delegated task — tell the principal what you tried."
      : "I could not finalize a response within iteration limits.";

    tracer?.runDone(AgentRunOutcome.MAX_ITERATIONS);
    await this.deps.memoryManager.appendSessionMessage(
      sessionId,
      AgentLoop.message("assistant", reply),
    );

    return { reply, outcome: AgentRunOutcome.MAX_ITERATIONS };
  }

  // ── Private utilities ──────────────────────────────────────────────────────

  private resolveIterationCap(requested: number | undefined): number {
    if (requested === undefined) return this.maxIterations;
    return Math.max(1, Math.min(requested, this.maxIterations));
  }

  private static formatFeedback(decision: AgentDecision, result: unknown): string {
    const label: Record<DecisionType, string> = {
      [DecisionType.ToolCall]: `Tool ${decision.tool} result`,
      [DecisionType.SkillCall]: `Skill ${decision.skill} result`,
      [DecisionType.MemoryWrite]: "Memory write result",
      [DecisionType.ProfileWrite]: "Profile write result",
      [DecisionType.Respond]: "Response",
    };

    const prefix = label[decision.type] ?? "Result";
    return `${prefix}: ${AgentLoop.stringify(result)}`;
  }

  private static stringify(value: unknown): string {
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  }

  private static message(role: Message["role"], content: string): Message {
    return { role, content, createdAt: new Date().toISOString() };
  }
}