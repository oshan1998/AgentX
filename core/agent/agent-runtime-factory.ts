import { randomUUID } from "node:crypto";
import type { SkillRegistry, ToolRegistry } from "../../common/interfaces/registry.js";
import type { LlmAdapter, SkillDelegateRunner, Tool, ToolContext } from "../../common/interfaces/types.js";
import type { SessionTraceHub } from "../../common/realtime/session-trace-hub.js";
import { MemoryManager } from "../../managers/memory-manager.js";
import { ProfileManager } from "../../managers/profile-manager.js";
import { DelegateSubAgentTool } from "../../core-tools/delegate-sub-agent.js";
import { OrchestrateTaskGraphTool } from "../../core-tools/orchestrate-task-graph.js";
import { createLlmAdapter } from "../../llm-adapters/factory.js";
import { Orchestrator } from "../orchestrator/orchestrator.js";
import { AgentLoop, AgentType } from "./agent-loop.js";
import {
  SUB_AGENT_DEFAULT_MAX_ITERATIONS,
  SUB_AGENT_DEFAULT_WALL_CLOCK_MS,
  SUB_AGENT_HARD_MAX_ITERATIONS,
  SUB_AGENT_HARD_MAX_WALL_CLOCK_MS,
} from "./agent-runtime-constants.js";
import { SUB_AGENT_EXECUTION_POLICY } from "./execution-policy.js";
import { cloneSkillWhitelist, cloneToolWhitelist } from "./sub-agent-registry.js";
import { AgentTracePhase } from "../../common/realtime/agent-trace-types.js";

export interface AgentRuntimeFactoryDeps {
  llm: LlmAdapter;
  memoryManager: MemoryManager;
  profileManager: ProfileManager;
  masterToolRegistry: ToolRegistry;
  masterSkillRegistry: SkillRegistry;
  sessionTraceHub?: SessionTraceHub;
}

export interface DelegateSubAgentToolInput {
  task: string;
  toolNames?: string[];
  skillNames?: string[];
  maxIterations?: number;
  deadlineMs?: number;
  model?: string;
}

function normalizeNameList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean);
}


export class AgentRuntimeFactory {
  private delegateMemo?: Tool;
  private orchestrateMemo?: Tool;
  private orchestratorMemo?: Orchestrator;
  /** Same delegation path as `delegate_sub_agent`, for agentic skills and nested sub-agents. */
  readonly skillDelegateRunner: SkillDelegateRunner;

  constructor(private readonly deps: AgentRuntimeFactoryDeps) {
    this.skillDelegateRunner = (_sessionId, tcx, params) =>
      this.runDelegatedTurn(
        {
          task: params.task,
          toolNames: params.toolNames,
          skillNames: params.skillNames,
          maxIterations: params.maxIterations,
          deadlineMs: params.deadlineMs,
          systemPromptAppend: params.systemPromptAppend,
          model: params.model,
        },
        tcx,
      );
  }

  /** Tool registered onto the principal registry so only the host agent may delegate. */
  get delegateTool(): Tool {
    return (this.delegateMemo ??= new DelegateSubAgentTool(this));
  }

  /** Lazily-created orchestrator for DAG-based parallel task execution. */
  get orchestrator(): Orchestrator {
    return (this.orchestratorMemo ??= new Orchestrator({
      llm: this.deps.llm,
      memoryManager: this.deps.memoryManager,
      profileManager: this.deps.profileManager,
      masterToolRegistry: this.deps.masterToolRegistry,
      masterSkillRegistry: this.deps.masterSkillRegistry,
      sessionTraceHub: this.deps.sessionTraceHub,
      skillDelegateRunner: this.skillDelegateRunner,
    }));
  }

  /** Tool registered onto the principal registry for DAG-based parallel execution. */
  get orchestrateTool(): Tool {
    return (this.orchestrateMemo ??= new OrchestrateTaskGraphTool(this.orchestrator));
  }

  async runDelegatedTurn(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<string> {
    const taskRaw = input.task;
    const task =
      typeof taskRaw === "string"
        ? taskRaw.trim()
        : typeof taskRaw === "object" &&
            taskRaw !== null &&
            "text" in taskRaw &&
            typeof (taskRaw as { text?: unknown }).text === "string"
          ? ((taskRaw as { text: string }).text.trim())
          : "";
    if (!task) {
      throw new Error("delegate_sub_agent requires a non-empty { task: string }.");
    }

    const toolNames = normalizeNameList(input.toolNames);
    const skillNames = normalizeNameList(input.skillNames);

    const resolvedMaxRaw = input.maxIterations;
    const resolvedMax =
      typeof resolvedMaxRaw === "number" &&
      Number.isFinite(resolvedMaxRaw) &&
      resolvedMaxRaw > 0
        ? Math.floor(resolvedMaxRaw)
        : SUB_AGENT_DEFAULT_MAX_ITERATIONS;
    const cappedIter = Math.min(
      Math.max(1, resolvedMax),
      SUB_AGENT_HARD_MAX_ITERATIONS,
    );

    const deadlineRaw = input.deadlineMs;
    const wallMs =
      typeof deadlineRaw === "number" &&
      Number.isFinite(deadlineRaw) &&
      deadlineRaw > 0
        ? Math.min(deadlineRaw, SUB_AGENT_HARD_MAX_WALL_CLOCK_MS)
        : SUB_AGENT_DEFAULT_WALL_CLOCK_MS;
    const deadlineAt = Date.now() + wallMs;

    const systemPromptAppendRaw = input.systemPromptAppend;
    const systemPromptAppend =
      typeof systemPromptAppendRaw === "string" && systemPromptAppendRaw.trim().length > 0
        ? systemPromptAppendRaw.trim()
        : undefined;

    const parentSessionId = ctx.sessionId;
    const parentRunId = ctx.runId;
    const hub = this.deps.sessionTraceHub;

    const subSessionId = await this.deps.memoryManager.createChildSession(
      parentSessionId,
    );
    const subRunId = randomUUID();

    const ac = new AbortController();
    const parentSignal = ctx.abortSignal;
    if (parentSignal) {
      if (parentSignal.aborted) ac.abort();
      else parentSignal.addEventListener("abort", () => ac.abort(), { once: true });
    }

    const subTools = cloneToolWhitelist(
      this.deps.masterToolRegistry,
      toolNames,
    );
    const subSkills = cloneSkillWhitelist(
      this.deps.masterSkillRegistry,
      skillNames,
    );

    if (hub && parentRunId) {
      hub.emitTraceStep(parentSessionId, parentRunId, {
        step: "sub_delegate",
        phase: AgentTracePhase.START,
        iteration: 0,
        subSessionId,
        subRunId,
      });
    }

    const subAgentModel = input.model as string | undefined;
    const subLlm = subAgentModel ? createLlmAdapter({ model: subAgentModel }) : this.deps.llm;

    const subLoop = new AgentLoop({
      llm: subLlm,
      memoryManager: this.deps.memoryManager,
      profileManager: this.deps.profileManager,
      toolRegistry: subTools,
      skillRegistry: subSkills,
      maxIterations: cappedIter,
      sessionTraceHub: this.deps.sessionTraceHub,
      executionPolicy: SUB_AGENT_EXECUTION_POLICY,
      agentType: AgentType.SubAgent,
      skillDelegateRunner: this.skillDelegateRunner,
    });

    let summary;
    try {
      summary = await subLoop.completeAgentRun(subSessionId, task, {
        runId: subRunId,
        abortSignal: ac.signal,
        deadlineAt,
        maxIterations: cappedIter,
        subAgentSystemPromptAppend: systemPromptAppend,
      });
    } catch (err) {
      if (hub && parentRunId) {
        hub.emitTraceStep(parentSessionId, parentRunId, {
          step: "sub_delegate",
          phase: AgentTracePhase.END,
          iteration: 0,
          subSessionId,
          subRunId,
        });
      }
      throw err;
    }

    if (hub && parentRunId) {
      hub.emitTraceStep(parentSessionId, parentRunId, {
        step: "sub_delegate",
        phase: AgentTracePhase.END,
        iteration: 0,
        subSessionId,
        subRunId,
        outcome: summary.outcome,
      });
    }

    const executionLog = await this.buildSubAgentExecutionLog(subSessionId);

    return JSON.stringify({
      ok: true,
      parentSessionId,
      subSessionId,
      subRunId,
      outcome: summary.outcome,
      response: summary.reply,
      executionLog,
    });
  }

  /**
   * Reads the completed sub-session's message history and synthesises a concise
   * chronological execution log so the parent agent understands what happened
   * inside the sub-agent loop — not just what the final reply said.
   *
   * Format:
   *   Step 1 [assistant]: <thought / decision>
   *   Step 2 [tool]:      <tool result / observation>
   *   ...
   *   Final reply:        <respond message>
   */
  private async buildSubAgentExecutionLog(subSessionId: string): Promise<string> {
    try {
      const session = await this.deps.memoryManager.getSession(subSessionId);
      // Skip the first message — that is the task injected as a "user" turn.
      const messages = session.messages.slice(1);

      if (messages.length === 0) {
        return "(No steps were recorded for this sub-agent run.)";
      }

      const lines: string[] = [];
      let stepIndex = 0;

      for (const msg of messages) {
        stepIndex++;
        const roleLabel = msg.role === "assistant" ? "thought/decision" : msg.role;

        // Attempt to surface the `thought` field if the content is JSON (LLM decision objects).
        let body = msg.content;
        if (msg.role === "assistant") {
          try {
            const parsed = JSON.parse(msg.content) as Record<string, unknown>;
            if (typeof parsed.thought === "string" && parsed.thought.trim()) {
              body = parsed.thought.trim();
            }
          } catch {
            // Plain text — use as-is.
          }
        }

        // Truncate very long tool results to keep the log readable.
        const MAX_BODY = 600;
        const truncated =
          body.length > MAX_BODY ? `${body.slice(0, MAX_BODY)}… [truncated]` : body;

        lines.push(`Step ${stepIndex} [${roleLabel}]: ${truncated}`);
      }

      return lines.join("\n");
    } catch {
      return "(Could not retrieve sub-agent execution history.)";
    }
  }
}

