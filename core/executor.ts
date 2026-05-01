import type { SkillRegistry, ToolRegistry } from "../common/interfaces/registry.js";
import type { AgentDecision, LongTermMemoryEntry } from "../common/interfaces/types.js";
import type { RunTracer } from "../common/realtime/agent-trace-types.js";
import { logger } from "../common/services/logger.js";
import { MemoryManager } from "../managers/memory-manager.js";
import { ProfileManager } from "../managers/profile-manager.js";

export interface ExecutorTraceContext {
  iteration: number;
  tracer: RunTracer;
}

export class Executor {
  constructor(
    private readonly memoryManager: MemoryManager,
    private readonly profileManager: ProfileManager,
    private readonly toolRegistry: ToolRegistry,
    private readonly skillRegistry: SkillRegistry
  ) {}

  async executeDecision(
    sessionId: string,
    decision: AgentDecision,
    trace?: ExecutorTraceContext,
  ): Promise<unknown> {
    switch (decision.type) {
      case "tool_call":
        return this.executeTool(sessionId, decision, trace);
      case "skill_call":
        return this.executeSkill(sessionId, decision, trace);
      case "memory_write":
        return this.executeMemoryWrite(decision, trace);
      case "profile_write":
        return this.executeProfileWrite(decision, trace);
      case "respond":
        return decision.message ?? "";
      default:
        throw new Error(`Unsupported decision type: ${String((decision as { type?: unknown }).type)}`);
    }
  }

  private async executeTool(
    sessionId: string,
    decision: AgentDecision,
    trace?: ExecutorTraceContext,
  ): Promise<unknown> {
    if (!decision.tool) {
      logger.error("Missing tool name in tool_call decision.");
      throw new Error("Missing tool name in tool_call decision.");
    }
    const tool = this.toolRegistry.get(decision.tool);
    if (!tool) {
      logger.error(`Tool not found: ${decision.tool}`);
      throw new Error(`Tool not found: ${decision.tool}`);
    }
    logger.info(`Executing tool: ${decision.tool}`);
    const iter = trace?.iteration ?? 0;
    trace?.tracer.tool(iter, decision.tool, "start");
    try {
      const result = await tool.run(decision.input ?? {}, { sessionId });
      logger.debug(`Tool execution completed: ${decision.tool}`);
      trace?.tracer.tool(iter, decision.tool, "end");
      return result;
    } catch (e) {
      logger.error(`Tool execution failed: ${decision.tool}`, { error: e instanceof Error ? e.message : String(e) });
      trace?.tracer.tool(iter, decision.tool, "end");
      throw e;
    }
  }

  private async executeSkill(
    sessionId: string,
    decision: AgentDecision,
    trace?: ExecutorTraceContext,
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
    trace?.tracer.skill(iter, skillName, "start");
    try {
      const result = await skill.run(decision.input ?? {}, {
        sessionId,
        runTool: async (name, input) => {
          logger.debug(`Skill ${decision.skill} requested tool execution: ${name}`);
          trace?.tracer.skillTool(iter, skillName, name, "start");
          const tool = this.toolRegistry.get(name);
          if (!tool) {
            logger.error(`Skill requested unknown tool: ${name}`);
            trace?.tracer.skillTool(iter, skillName, name, "end");
            throw new Error(`Skill requested unknown tool: ${name}`);
          }
          try {
            const out = await tool.run(input, { sessionId });
            trace?.tracer.skillTool(iter, skillName, name, "end");
            return out;
          } catch (err) {
            trace?.tracer.skillTool(iter, skillName, name, "end");
            throw err;
          }
        },
        searchMemory: async (query) => {
          logger.debug(`Skill ${decision.skill} searched memory`);
          return this.memoryManager.searchLongTermMemory(query);
        },
        writeMemory: async (entry) => {
          logger.debug(`Skill ${decision.skill} writing memory`);
          return this.memoryManager.addLongTermMemory(entry);
        },
        writeProfile: async (target, content) => {
          logger.debug(`Skill ${decision.skill} writing profile: ${target}`);
          if (target === "soul") {
            return this.profileManager.setSoul(content);
          } else {
            return this.profileManager.setUser(content);
          }
        }
      });
      logger.debug(`Skill execution completed: ${decision.skill}`);
      trace?.tracer.skill(iter, skillName, "end");
      return result;
    } catch (e) {
      logger.error(`Skill execution failed: ${decision.skill}`, { error: e instanceof Error ? e.message : String(e) });
      trace?.tracer.skill(iter, skillName, "end");
      throw e;
    }
  }

  private async executeMemoryWrite(
    decision: AgentDecision,
    trace?: ExecutorTraceContext,
  ): Promise<LongTermMemoryEntry> {
    if (!decision.memoryEntry) {
      logger.error("Missing memoryEntry in memory_write decision.");
      throw new Error("Missing memoryEntry in memory_write decision.");
    }
    logger.info("Executing memory_write decision");
    const iter = trace?.iteration ?? 0;
    trace?.tracer.memoryWrite(iter, "start");
    const entry = await this.memoryManager.addLongTermMemory(decision.memoryEntry);
    trace?.tracer.memoryWrite(iter, "end");
    return entry;
  }

  private async executeProfileWrite(
    decision: AgentDecision,
    trace?: ExecutorTraceContext,
  ): Promise<unknown> {
    if (!decision.target || !decision.content) {
      logger.error("Missing target or content in profile_write decision.");
      throw new Error("Missing target or content in profile_write decision.");
    }
    const { target, content } = decision;
    const iter = trace?.iteration ?? 0;
    trace?.tracer.profileWrite(iter, "start", target);
    let out: unknown;
    if (target === "soul") {
      logger.info("Updating agent soul profile.");
      out = await this.profileManager.setSoul(content);
    } else if (target === "user") {
      logger.info("Updating user profile.");
      out = await this.profileManager.setUser(content);
    } else {
      trace?.tracer.profileWrite(iter, "end", String(target));
      throw new Error(`Invalid target for profile_write: ${String(target)}`);
    }
    trace?.tracer.profileWrite(iter, "end", target);
    return out;
  }
}
