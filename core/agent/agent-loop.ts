import { SkillRegistry, ToolRegistry } from "../../common/interfaces/registry.js";
import { VectorManager } from "../../managers/vector-manager.js";
import {
  DecisionType,
  type AgentDecision,
  type LlmAdapter,
  type Message,
  type SkillDelegateRunner,
} from "../../common/interfaces/types.js";
import type { SessionTraceHub } from "../../common/realtime/session-trace-hub.js";
import {
  AgentRunOutcome,
  AgentTracePhase,
  type AgentTraceRunOutcome,
} from "../../common/realtime/agent-trace-types.js";
import {
  composeMemorySearchQuery,
  MAX_OBSERVATION_CHARS,
  truncateForPrompt,
} from "../../common/services/prompt-truncation.js";
import { Executor } from "./executor.js";
import type { ExecutorInvocationContext, ExecutorTraceContext } from "./executor.js";
import {
  PRIMARY_AGENT_EXECUTION_POLICY,
  type ExecutionPolicy,
} from "./execution-policy.js";
import { MemoryManager } from "../../managers/memory-manager.js";
import { PromptBuilder } from "./prompt-builder.js";
import { ProfileManager } from "../../managers/profile-manager.js";
import { logger } from "../../common/services/logger.js";
import {
  type CapabilityRetrievalMethod,
} from "./capability-retriever.js";
import {
  buildRunPromptContext,
  type RunPromptContext,
} from "./run-context-pipeline.js";

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
  vectorManager?: VectorManager;
  /** Override env `CAPABILITY_RETRIEVAL_METHOD` (`rag` | `llm`). */
  capabilityRetrievalMethod?: CapabilityRetrievalMethod;
}

/** Upper bound on actions executed in parallel for a single `batch` decision. */
const MAX_BATCH_ACTIONS = 5;

/** Decision types eligible to run inside a parallel `batch` (must be side-effect-independent). */
const BATCHABLE_DECISION_TYPES: ReadonlySet<DecisionType> = new Set([
  DecisionType.ToolCall,
  DecisionType.SkillCall,
]);

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
    this.maxIterations = deps.maxIterations ?? 10;
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

    const runContext = await buildRunPromptContext(this.deps, {
      sessionId,
      userInput,
      isSubAgent,
      subAgentSystemPromptAppend: options?.subAgentSystemPromptAppend,
    });

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
            runContext,
            { iteration, iterCap, lastObservation },
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
            await this.appendRunMessage(runContext, AgentLoop.message("assistant", error.message));
            return { reply: error.message, outcome: error.outcome };
          }

          lastObservation = this.handleIterationError(sessionId, iteration, error);
          await this.appendRunMessage(
            runContext,
            AgentLoop.message("tool", lastObservation),
            { truncateObservation: true },
          );
        }
      }

      return this.buildMaxIterationsOutcome(runContext, isSubAgent, tracer);
    } finally {
      if (registeredRunId) {
        this.activeRunControllers.delete(registeredRunId);
      }
    }
  }

  private async appendRunMessage(
    runContext: RunPromptContext,
    message: Message,
    options?: { truncateObservation?: boolean },
  ): Promise<void> {
    let content = message.content;
    if (options?.truncateObservation && message.role === "tool") {
      content = truncateForPrompt(content, MAX_OBSERVATION_CHARS);
    }

    const stored: Message =
      content === message.content ? message : { ...message, content };

    runContext.session.messages.push(stored);
    runContext.session.updatedAt = new Date().toISOString();
    await this.deps.memoryManager.appendSessionMessage(runContext.sessionId, stored);
  }

  // ── Iteration helpers ──────────────────────────────────────────────────────

  /**
   * Runs a single agent iteration: builds the prompt, calls the LLM, and
   * either returns the final reply or executes the chosen tool/skill.
   */
  private async runIteration(
    runContext: RunPromptContext,
    ctx: {
      iteration: number;
      iterCap: number;
      lastObservation: string | undefined;
    },
    traceCtx: ExecutorTraceContext | undefined,
    invocation: ExecutorInvocationContext,
  ): Promise<IterationResult> {
    const { systemPrompt, userPrompt } = await this.buildPrompt(runContext, ctx);

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
      staticPromptChars: systemPrompt.length,
      dynamicPromptChars: userPrompt.length,
    });

    traceCtx?.tracer.thought(ctx.iteration, AgentTracePhase.END, decision.thought ?? "");

    if (decision.type === DecisionType.Respond) {
      return this.handleRespond(runContext, decision.message ?? "");
    }

    if (decision.type === DecisionType.Batch) {
      return this.handleBatch(runContext, decision, traceCtx, invocation);
    }

    return this.handleToolOrSkill(runContext, decision, traceCtx, invocation);
  }

  private async buildPrompt(
    runContext: RunPromptContext,
    ctx: {
      iteration: number;
      iterCap: number;
      lastObservation: string | undefined;
    },
  ): Promise<{ systemPrompt: string; userPrompt: string }> {
    const memoryQuery = composeMemorySearchQuery(
      runContext.userInput,
      ctx.lastObservation,
      ctx.iteration,
    );

    const relevantLongTermMemory =
      ctx.iteration === 1 && runContext.contextRoute?.relevantLongTermMemory
        ? runContext.contextRoute.relevantLongTermMemory
        : await this.deps.memoryManager.searchLongTermMemory(memoryQuery);

    const userPrompt = this.promptBuilder.buildDynamicUser({
      latestUserMessage: runContext.userInput,
      messages: runContext.session.messages,
      relevantLongTermMemory,
      lastObservation: ctx.lastObservation,
      iteration: ctx.iteration,
      maxIterations: ctx.iterCap,
      isSubAgent: runContext.isSubAgent,
      isBootstrapComplete: runContext.isBootstrapComplete,
    });

    return {
      systemPrompt: runContext.staticSystemPrompt,
      userPrompt,
    };
  }

  private async handleRespond(
    runContext: RunPromptContext,
    finalMessage: string,
  ): Promise<IterationResult> {
    logger.info(`Agent responded for session ${runContext.sessionId}`, { message: finalMessage });
    await this.appendRunMessage(runContext, AgentLoop.message("assistant", finalMessage));
    return { finalReply: finalMessage };
  }

  private async handleToolOrSkill(
    runContext: RunPromptContext,
    decision: AgentDecision,
    traceCtx: ExecutorTraceContext | undefined,
    invocation: ExecutorInvocationContext,
  ): Promise<IterationResult> {
    const result = await this.executor.executeDecision(
      runContext.sessionId,
      decision,
      traceCtx,
      invocation,
    );
    logger.info("Executed decision", {
      type: decision.type,
      tool: decision.tool,
      skill: decision.skill,
    });

    const observation = truncateForPrompt(
      AgentLoop.formatFeedback(decision, result),
      MAX_OBSERVATION_CHARS,
    );
    await this.appendRunMessage(runContext, AgentLoop.message("tool", observation));
    return { observation };
  }

  /**
   * Runs several independent tool/skill actions concurrently within a single turn,
   * collapsing 1 LLM call + N sequential round-trips into 1 LLM call + 1 parallel batch.
   * Uses `allSettled` so one failure does not discard the other results.
   */
  private async handleBatch(
    runContext: RunPromptContext,
    decision: AgentDecision,
    traceCtx: ExecutorTraceContext | undefined,
    invocation: ExecutorInvocationContext,
  ): Promise<IterationResult> {
    const actions = (decision.actions ?? []).slice(0, MAX_BATCH_ACTIONS);

    if (actions.length === 0) {
      const observation = "Batch error: 'actions' was empty. Provide independent tool_call/skill_call actions, or use a single action.";
      await this.appendRunMessage(runContext, AgentLoop.message("tool", observation));
      return { observation };
    }

    const settled = await Promise.allSettled(
      actions.map((action) => {
        if (!BATCHABLE_DECISION_TYPES.has(action.type)) {
          return Promise.reject(
            new Error(
              `Only tool_call and skill_call may run in a batch; got "${action.type}". Run it as a standalone decision instead.`,
            ),
          );
        }
        return this.executor.executeDecision(
          runContext.sessionId,
          action,
          traceCtx,
          invocation,
        );
      }),
    );

    logger.info("Executed batch decision", { actionCount: actions.length });

    // Split the observation budget evenly so one large result cannot starve the rest.
    const perActionBudget = Math.max(1, Math.floor(MAX_OBSERVATION_CHARS / actions.length));
    const observation = actions
      .map((action, i) => {
        const outcome = settled[i];
        const result =
          outcome.status === "fulfilled"
            ? outcome.value
            : `Error: ${outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)}`;
        return truncateForPrompt(
          `[${i + 1}/${actions.length}] ${AgentLoop.formatFeedback(action, result)}`,
          perActionBudget,
        );
      })
      .join("\n\n");

    await this.appendRunMessage(runContext, AgentLoop.message("tool", observation));
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
    return truncateForPrompt(`Error: ${message}`, MAX_OBSERVATION_CHARS);
  }

  private async buildMaxIterationsOutcome(
    runContext: RunPromptContext,
    isSubAgent: boolean,
    tracer: ReturnType<SessionTraceHub["createRunTracer"]> | undefined,
  ): Promise<AgentRunSummary> {
    logger.warn(`Agent failed to respond within iteration limits for session ${runContext.sessionId}`);

    const reply = isSubAgent
      ? "Could not finalize delegated task — tell the principal what you tried."
      : "I could not finalize a response within iteration limits.";

    tracer?.runDone(AgentRunOutcome.MAX_ITERATIONS);
    await this.appendRunMessage(runContext, AgentLoop.message("assistant", reply));

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
      [DecisionType.Batch]: "Batch result",
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
