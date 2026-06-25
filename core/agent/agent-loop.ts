import type {
  SkillRegistry,
  ToolRegistry,
} from "../../common/interfaces/registry.js";
import {
  DecisionType,
  type AgentDecision,
  type LlmAdapter,
  type Message,
  type SessionMemory,
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
import type {
  ExecutorInvocationContext,
  ExecutorTraceContext,
} from "./executor.js";
import {
  PRIMARY_AGENT_EXECUTION_POLICY,
  type ExecutionPolicy,
} from "./execution-policy.js";
import { MemoryManager } from "../../managers/memory-manager.js";
import { PromptBuilder } from "./prompt-builder/index.js";
import {
  buildMcpServerCatalog,
  routeMcpServers,
} from "../../managers/mcp/mcp-server-catalog.js";
import type { Soul, User } from "../../managers/profile-manager.js";
import { ProfileManager } from "../../managers/profile-manager.js";
import { logger } from "../../common/services/logger.js";

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

/** Run-scoped prompt state: static system prompt and in-memory session mirror. */
interface RunPromptContext {
  sessionId: string;
  session: SessionMemory;
  userInput: string;
  isSubAgent: boolean;
  isBootstrapComplete: boolean;
  soul: Soul;
  user: User;
  staticSystemPrompt: string;
  subAgentSystemPromptAppend?: string;
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
  /** Plan emitted at iteration 1; carried forward to keep the agent on track. */
  plan?: string[];
}

// ─── Class ───────────────────────────────────────────────────────────────────

export class AgentLoop {
  private readonly promptBuilder = new PromptBuilder();
  private readonly executor: Executor;
  private readonly maxIterations: number;
  private readonly executionPolicy: ExecutionPolicy;
  /** runId → controller for cooperative cancel (explicit stop or layered with caller signal). */
  private readonly activeRunControllers = new Map<string, AbortController>();

  constructor(private readonly deps: AgentLoopDependencies) {
    this.executionPolicy =
      deps.executionPolicy ?? PRIMARY_AGENT_EXECUTION_POLICY;
    this.executor = new Executor(
      deps.memoryManager,
      deps.profileManager,
      deps.toolRegistry,
      deps.skillRegistry,
      this.executionPolicy,
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
    const { reply } = await this.completeAgentRun(
      sessionId,
      userInput,
      options,
    );
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

    const runContext = await this.createRunPromptContext(
      sessionId,
      userInput,
      isSubAgent,
      options,
    );

    try {
      const iterCap = this.resolveIterationCap(options?.maxIterations);
      const invocation: ExecutorInvocationContext = {
        runId: options?.runId,
        abortSignal: loopHandleOptions?.abortSignal,
      };

      let lastObservation: string | undefined;
      let activePlan: string[] | undefined;

      for (let i = 0; i < iterCap; i++) {
        const iteration = i + 1;
        const traceCtx: ExecutorTraceContext | undefined = tracer
          ? { iteration, tracer }
          : undefined;

        try {
          this.checkForEarlyExit(loopHandleOptions, isSubAgent);

          const result = await this.runIteration(
            runContext,
            {
              iteration,
              iterCap,
              lastObservation,
              activePlan,
              options,
            },
            traceCtx,
            invocation,
          );

          if (result.finalReply !== undefined) {
            tracer?.runDone(AgentRunOutcome.COMPLETE);
            return {
              reply: result.finalReply,
              outcome: AgentRunOutcome.COMPLETE,
            };
          }

          lastObservation = result.observation;
          if (result.plan?.length) activePlan = result.plan;
        } catch (error) {
          if (error instanceof EarlyExit) {
            tracer?.runDone(error.outcome);
            await this.appendRunMessage(
              runContext,
              AgentLoop.message("assistant", error.message),
            );
            return { reply: error.message, outcome: error.outcome };
          }

          lastObservation = this.handleIterationError(
            sessionId,
            iteration,
            error,
          );
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

  // ── Run prompt context ─────────────────────────────────────────────────────

  private async createRunPromptContext(
    sessionId: string,
    userInput: string,
    isSubAgent: boolean,
    options?: AgentRunHandleOptions,
  ): Promise<RunPromptContext> {
    const session = await this.deps.memoryManager.getSession(sessionId);
    const allMemory = await this.deps.memoryManager.getLongTermMemory();
    const soul = await this.deps.profileManager.getSoul();
    const user = await this.deps.profileManager.getUser();

    const isBootstrapComplete = isSubAgent
      ? true
      : allMemory.some((m) => m.content === "bootstrap_complete");

    const subAgentSystemPromptAppend = isSubAgent
      ? options?.subAgentSystemPromptAppend
      : undefined;

    const inlineSchemaMcpServers =
      !isSubAgent
        ? routeMcpServers(userInput, buildMcpServerCatalog(this.deps.toolRegistry))
        : undefined;

    const staticSystemPrompt = this.promptBuilder.buildStaticSystem({
      sessionId,
      soul,
      user,
      toolRegistry: this.deps.toolRegistry,
      skillRegistry: this.deps.skillRegistry,
      isSubAgent,
      isBootstrapComplete,
      subAgentSystemPromptAppend,
      inlineSchemaMcpServers,
    });

    logger.debug("Built static system prompt for run", {
      sessionId,
      staticPromptChars: staticSystemPrompt.length,
    });

    return {
      sessionId,
      session,
      userInput,
      isSubAgent,
      isBootstrapComplete,
      soul,
      user,
      staticSystemPrompt,
      subAgentSystemPromptAppend,
    };
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
    await this.deps.memoryManager.appendSessionMessage(
      runContext.sessionId,
      stored,
    );
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
      activePlan: string[] | undefined;
      options?: AgentRunHandleOptions;
    },
    traceCtx: ExecutorTraceContext | undefined,
    invocation: ExecutorInvocationContext,
  ): Promise<IterationResult> {
    const { systemPrompt, userPrompt } = await this.buildPrompt(
      runContext,
      ctx,
    );

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

    traceCtx?.tracer.thought(
      ctx.iteration,
      AgentTracePhase.END,
      decision.thought ?? "",
    );

    if (decision.type === DecisionType.Respond) {
      return this.handleRespond(runContext, decision);
    }

    const result = await this.handleToolOrSkill(
      runContext,
      decision,
      traceCtx,
      invocation,
    );
    return { ...result, plan: decision.plan };
  }

  private async buildPrompt(
    runContext: RunPromptContext,
    ctx: {
      iteration: number;
      iterCap: number;
      lastObservation: string | undefined;
      activePlan: string[] | undefined;
      options?: AgentRunHandleOptions;
    },
  ) {
    const relevantLongTermMemory =
      await this.deps.memoryManager.searchLongTermMemory(
        composeMemorySearchQuery(
          runContext.userInput,
          ctx.lastObservation,
          ctx.iteration,
        ),
      );

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
    decision: AgentDecision,
  ): Promise<IterationResult> {
    const finalMessage = decision.message ?? "";

    if (
      decision.memoryEntries?.length &&
      this.executionPolicy.allowDecisionMemoryWrite
    ) {
      await Promise.all(
        decision.memoryEntries.map((entry) =>
          this.deps.memoryManager.addLongTermMemory(entry),
        ),
      );
    }

    logger.info(`Agent responded for session ${runContext.sessionId}`, {
      message: finalMessage,
    });
    await this.appendRunMessage(
      runContext,
      AgentLoop.message("assistant", finalMessage),
    );
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
    await this.appendRunMessage(
      runContext,
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

  private handleIterationError(
    sessionId: string,
    iteration: number,
    error: unknown,
  ): string {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(
      `Error in agent loop iteration ${iteration} for session ${sessionId}`,
      {
        error: message,
      },
    );
    return truncateForPrompt(`Error: ${message}`, MAX_OBSERVATION_CHARS);
  }

  private async buildMaxIterationsOutcome(
    runContext: RunPromptContext,
    isSubAgent: boolean,
    tracer: ReturnType<SessionTraceHub["createRunTracer"]> | undefined,
  ): Promise<AgentRunSummary> {
    logger.warn(
      `Agent failed to respond within iteration limits for session ${runContext.sessionId}`,
    );

    const reply = isSubAgent
      ? "Could not finalize delegated task — tell the principal what you tried."
      : "I could not finalize a response within iteration limits.";

    tracer?.runDone(AgentRunOutcome.MAX_ITERATIONS);
    await this.appendRunMessage(
      runContext,
      AgentLoop.message("assistant", reply),
    );

    return { reply, outcome: AgentRunOutcome.MAX_ITERATIONS };
  }

  // ── Private utilities ──────────────────────────────────────────────────────

  private resolveIterationCap(requested: number | undefined): number {
    if (requested === undefined) return this.maxIterations;
    return Math.max(1, Math.min(requested, this.maxIterations));
  }

  private static formatFeedback(
    decision: AgentDecision,
    result: unknown,
  ): string {
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
