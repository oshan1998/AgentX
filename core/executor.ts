import type { SkillRegistry, ToolRegistry } from "../interfaces/registry.js";
import type { AgentDecision, LongTermMemoryEntry } from "../interfaces/types.js";
import { MemoryManager } from "../managers/memory-manager.js";
import { ProfileManager } from "../managers/profile-manager.js";
import { logger } from "../services/logger.js";

export class Executor {
  constructor(
    private readonly memoryManager: MemoryManager,
    private readonly profileManager: ProfileManager,
    private readonly toolRegistry: ToolRegistry,
    private readonly skillRegistry: SkillRegistry
  ) {}

  async executeDecision(sessionId: string, decision: AgentDecision): Promise<unknown> {
    switch (decision.type) {
      case "tool_call":
        return this.executeTool(sessionId, decision);
      case "skill_call":
        return this.executeSkill(sessionId, decision);
      case "memory_write":
        return this.executeMemoryWrite(decision);
      case "profile_write":
        return this.executeProfileWrite(decision);
      case "respond":
        return decision.message ?? "";
      default:
        throw new Error(`Unsupported decision type: ${String((decision as { type?: unknown }).type)}`);
    }
  }

  private async executeTool(sessionId: string, decision: AgentDecision): Promise<unknown> {
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
    try {
      const result = await tool.run(decision.input ?? {}, { sessionId });
      logger.debug(`Tool execution completed: ${decision.tool}`);
      return result;
    } catch (e) {
      logger.error(`Tool execution failed: ${decision.tool}`, { error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  }

  private async executeSkill(sessionId: string, decision: AgentDecision): Promise<unknown> {
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
    try {
      const result = await skill.run(decision.input ?? {}, {
        sessionId,
        runTool: async (name, input) => {
          logger.debug(`Skill ${decision.skill} requested tool execution: ${name}`);
          const tool = this.toolRegistry.get(name);
          if (!tool) {
            logger.error(`Skill requested unknown tool: ${name}`);
            throw new Error(`Skill requested unknown tool: ${name}`);
          }
          return tool.run(input, { sessionId });
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
      return result;
    } catch (e) {
      logger.error(`Skill execution failed: ${decision.skill}`, { error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  }

  private async executeMemoryWrite(decision: AgentDecision): Promise<LongTermMemoryEntry> {
    if (!decision.memoryEntry) {
      logger.error("Missing memoryEntry in memory_write decision.");
      throw new Error("Missing memoryEntry in memory_write decision.");
    }
    logger.info("Executing memory_write decision");
    return this.memoryManager.addLongTermMemory(decision.memoryEntry);
  }

  private async executeProfileWrite(decision: AgentDecision): Promise<unknown> {
    if (!decision.target || !decision.content) {
      logger.error("Missing target or content in profile_write decision.");
      throw new Error("Missing target or content in profile_write decision.");
    }
    const { target, content } = decision;
    if (target === "soul") {
      logger.info("Updating agent soul profile.");
      return this.profileManager.setSoul(content);
    } else if (target === "user") {
      logger.info("Updating user profile.");
      return this.profileManager.setUser(content);
    } else {
      throw new Error(`Invalid target for profile_write: ${String(target)}`);
    }
  }
}
