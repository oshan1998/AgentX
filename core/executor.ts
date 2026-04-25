import type { SkillRegistry, ToolRegistry } from "../interfaces/registry.js";
import type { AgentDecision, LongTermMemoryEntry } from "../interfaces/types.js";
import { MemoryManager } from "./memory-manager.js";

export class Executor {
  constructor(
    private readonly memoryManager: MemoryManager,
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
      case "respond":
        return decision.message ?? "";
      default:
        throw new Error(`Unsupported decision type: ${String((decision as { type?: unknown }).type)}`);
    }
  }

  private async executeTool(sessionId: string, decision: AgentDecision): Promise<unknown> {
    if (!decision.tool) {
      throw new Error("Missing tool name in tool_call decision.");
    }
    const tool = this.toolRegistry.get(decision.tool);
    if (!tool) {
      throw new Error(`Tool not found: ${decision.tool}`);
    }
    return tool.run(decision.input ?? {}, { sessionId });
  }

  private async executeSkill(sessionId: string, decision: AgentDecision): Promise<unknown> {
    if (!decision.skill) {
      throw new Error("Missing skill name in skill_call decision.");
    }
    const skill = this.skillRegistry.get(decision.skill);
    if (!skill) {
      throw new Error(`Skill not found: ${decision.skill}`);
    }
    return skill.run(decision.input ?? {}, {
      sessionId,
      runTool: async (name, input) => {
        const tool = this.toolRegistry.get(name);
        if (!tool) {
          throw new Error(`Skill requested unknown tool: ${name}`);
        }
        return tool.run(input, { sessionId });
      },
      searchMemory: async (query) => this.memoryManager.searchLongTermMemory(query),
      writeMemory: async (entry) => this.memoryManager.addLongTermMemory(entry)
    });
  }

  private async executeMemoryWrite(decision: AgentDecision): Promise<LongTermMemoryEntry> {
    if (!decision.memoryEntry) {
      throw new Error("Missing memoryEntry in memory_write decision.");
    }
    return this.memoryManager.addLongTermMemory(decision.memoryEntry);
  }
}
