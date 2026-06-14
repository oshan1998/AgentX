import type { SkillRegistry, ToolRegistry } from "../../common/interfaces/registry.js";
import {
  DecisionType,
  type AgentDecision,
  type LongTermMemoryEntry,
  type SkillDelegateRunner,
  type ToolContext,
} from "../../common/interfaces/types.js";
import { AgentTracePhase, type RunTracer } from "../../common/realtime/agent-trace-types.js";
import { logger } from "../../common/services/logger.js";
import { MemoryManager } from "../../managers/memory-manager.js";
import { ProfileManager } from "../../managers/profile-manager.js";
import {
  PRIMARY_AGENT_EXECUTION_POLICY,
  type ExecutionPolicy,
} from "./execution-policy.js";

export interface ExecutorTraceContext {
  iteration: number;
  tracer: RunTracer;
}

export interface ExecutorInvocationContext {
  /** Tool run linkage for tracing delegation; optional outside HTTP runs. */
  runId?: string;
  abortSignal?: AbortSignal;
}

export class Executor {
  constructor(
    private readonly memoryManager: MemoryManager,
    private readonly profileManager: ProfileManager,
    private readonly toolRegistry: ToolRegistry,
    private readonly skillRegistry: SkillRegistry,
    private readonly executionPolicy: ExecutionPolicy = PRIMARY_AGENT_EXECUTION_POLICY,
    private readonly skillDelegateRunner?: SkillDelegateRunner,
  ) {}

  async executeDecision(
    sessionId: string,
    decision: AgentDecision,
    trace?: ExecutorTraceContext,
    invocation?: ExecutorInvocationContext,
  ): Promise<unknown> {
    switch (decision.type) {
      case DecisionType.ToolCall:
        return this.executeTool(sessionId, decision, trace, invocation);
      case DecisionType.SkillCall:
        return this.executeSkill(sessionId, decision, trace, invocation);
      case DecisionType.MemoryWrite:
        return this.executeMemoryWrite(decision, trace);
      case DecisionType.ProfileWrite:
        return this.executeProfileWrite(decision, trace);
      case DecisionType.Respond:
        return decision.message ?? "";
      default:
        throw new Error(`Unsupported decision type: ${decision.type}`);
    }
  }

  private toolContext(sessionId: string, invocation?: ExecutorInvocationContext): ToolContext {
    return {
      sessionId,
      runId: invocation?.runId,
      abortSignal: invocation?.abortSignal,
    };
  }

  private async executeTool(
    sessionId: string,
    decision: AgentDecision,
    trace?: ExecutorTraceContext,
    invocation?: ExecutorInvocationContext,
  ): Promise<unknown> {
    if (!decision.tool) {
      logger.error(`Missing tool name in ${DecisionType.ToolCall} decision.`);
      throw new Error(`Missing tool name in ${DecisionType.ToolCall} decision.`);
    }
    const tool = this.toolRegistry.get(decision.tool);
    if (!tool) {
      logger.error(`Tool not found: ${decision.tool}`);
      throw new Error(`Tool not found: ${decision.tool}`);
    }
    logger.info(`Executing tool: ${decision.tool}`);
    const iter = trace?.iteration ?? 0;
    trace?.tracer.tool(iter, decision.tool, AgentTracePhase.START);
    try {
      const result = await tool.run(
        decision.input ?? {},
        this.toolContext(sessionId, invocation),
      );
      logger.debug(`Tool execution completed: ${decision.tool}`);
      trace?.tracer.tool(iter, decision.tool, AgentTracePhase.END);
      return result;
    } catch (e) {
      logger.error(`Tool execution failed: ${decision.tool}`, {
        error: e instanceof Error ? e.message : String(e),
      });
      trace?.tracer.tool(iter, decision.tool, AgentTracePhase.END);
      throw e;
    }
  }

  private async executeSkill(
    sessionId: string,
    decision: AgentDecision,
    trace?: ExecutorTraceContext,
    invocation?: ExecutorInvocationContext,
  ): Promise<unknown> {
    if (!decision.skill) {
      logger.error("Missing skill name in skill_call decision.");
      throw new Error("Missing skill name in skill_call decision.");
    }
    const skill = this.skillRegistry.get(decision.skill);
    if (!skill) {
      logger.error(`Skill not found: ${decision.skill}`);
      throw new Error(`Skill not found: ${decision.skill}`);
    }
    logger.info(`Executing skill: ${decision.skill}`);
    const iter = trace?.iteration ?? 0;
    const skillName = decision.skill;
    const policy = this.executionPolicy;
    const tcx = this.toolContext(sessionId, invocation);
    trace?.tracer.skill(iter, skillName, AgentTracePhase.START);
    try {
      const result = await skill.run(decision.input ?? {}, {
        sessionId,
        abortSignal: tcx.abortSignal,
        runTool: async (name, input) => {
          logger.debug(`Skill ${decision.skill} requested tool execution: ${name}`);
          trace?.tracer.skillTool(iter, skillName, name, AgentTracePhase.START);
          const tool = this.toolRegistry.get(name);
          if (!tool) {
            logger.error(`Skill requested unknown tool: ${name}`);
            trace?.tracer.skillTool(iter, skillName, name, AgentTracePhase.END);
            throw new Error(`Skill requested unknown tool: ${name}`);
          }
          try {
            const out = await tool.run(input, tcx);
            trace?.tracer.skillTool(iter, skillName, name, AgentTracePhase.END);
            return out;
          } catch (err) {
            trace?.tracer.skillTool(iter, skillName, name, AgentTracePhase.END);
            throw err;
          }
        },
        searchMemory: async (query) => {
          logger.debug(`Skill ${decision.skill} searched memory`);
          return this.memoryManager.searchLongTermMemory(query);
        },
        writeMemory: async (entry) => {
          if (!policy.allowSkillMemoryWrite) {
            throw new Error(
              "Delegated sub-agents cannot write long-term memory; return facts in your reply so the principal agent can persist them.",
            );
          }
          logger.debug(`Skill ${decision.skill} writing memory`);
          return this.memoryManager.addLongTermMemory(entry);
        },
        writeProfile: async (target, content) => {
          if (!policy.allowSkillProfileWrite) {
            throw new Error(
              "Delegated sub-agents cannot update profiles; return structured updates so the principal agent can persist them.",
            );
          }
          logger.debug(`Skill ${decision.skill} writing profile: ${target}`);
          if (target === "soul") {
            return this.profileManager.setSoul(content);
          }
          return this.profileManager.setUser(content);
        },
        delegateSubAgent: this.skillDelegateRunner
          ? async (params) =>
              this.skillDelegateRunner!(sessionId, tcx, params)
          : undefined,
      });
      logger.debug(`Skill execution completed: ${decision.skill}`);
      trace?.tracer.skill(iter, skillName, AgentTracePhase.END);
      return result;
    } catch (e) {
      logger.error(`Skill execution failed: ${decision.skill}`, {
        error: e instanceof Error ? e.message : String(e),
      });
      trace?.tracer.skill(iter, skillName, AgentTracePhase.END);
      throw e;
    }
  }

  private async executeMemoryWrite(
    decision: AgentDecision,
    trace?: ExecutorTraceContext,
  ): Promise<LongTermMemoryEntry | string> {
    if (!this.executionPolicy.allowDecisionMemoryWrite) {
      return (
        "memory_write is disabled for delegated runs — include facts in your assistant reply so the principal agent can call memory_write."
      );
    }
    if (!decision.memoryEntry) {
      logger.error("Missing memoryEntry in memory_write decision.");
      throw new Error("Missing memoryEntry in memory_write decision.");
    }
    logger.info("Executing memory_write decision");
    const iter = trace?.iteration ?? 0;
    trace?.tracer.memoryWrite(iter, AgentTracePhase.START);
    const entry = await this.memoryManager.addLongTermMemory(decision.memoryEntry);
    trace?.tracer.memoryWrite(iter, AgentTracePhase.END);
    return entry;
  }

  private async executeProfileWrite(
    decision: AgentDecision,
    trace?: ExecutorTraceContext,
  ): Promise<unknown> {
    if (!this.executionPolicy.allowDecisionProfileWrite) {
      return (
        "profile_write is disabled for delegated runs — return the profile deltas in prose or JSON so the principal agent can call profile_write."
      );
    }
    if (!decision.target || !decision.content) {
      logger.error("Missing target or content in profile_write decision.");
      throw new Error("Missing target or content in profile_write decision.");
    }
    const { target, content } = decision;
    const iter = trace?.iteration ?? 0;
    trace?.tracer.profileWrite(iter, AgentTracePhase.START, target);
    let out: unknown;
    if (target === "soul") {
      logger.info("Updating agent soul profile.");
      out = await this.profileManager.setSoul(content);
    } else if (target === "user") {
      logger.info("Updating user profile.");
      out = await this.profileManager.setUser(content);
    } else {
      trace?.tracer.profileWrite(iter, AgentTracePhase.END, String(target));
      throw new Error(`Invalid target for profile_write: ${String(target)}`);
    }
    trace?.tracer.profileWrite(iter, AgentTracePhase.END, target);
    return out;
  }
}
