import type { SkillRegistry, ToolRegistry } from "../common/interfaces/registry.js";
import type {
  AgentDecision,
  LlmAdapter,
  Message,
} from "../common/interfaces/types.js";
import { Executor } from "./executor.js";
import { MemoryManager } from "../managers/memory-manager.js";
import { PromptBuilder } from "./prompt-builder.js";
import { ProfileManager } from "../managers/profile-manager.js";
import { logger } from "../common/services/logger.js";

interface AgentLoopDependencies {
  llm: LlmAdapter;
  memoryManager: MemoryManager;
  profileManager: ProfileManager;
  toolRegistry: ToolRegistry;
  skillRegistry: SkillRegistry;
  maxIterations?: number;
}

export class AgentLoop {
  private readonly promptBuilder = new PromptBuilder();
  private readonly executor: Executor;
  private readonly maxIterations: number;

  constructor(private readonly deps: AgentLoopDependencies) {
    this.executor = new Executor(
      deps.memoryManager,
      deps.profileManager,
      deps.toolRegistry,
      deps.skillRegistry,
    );
    this.maxIterations = deps.maxIterations ?? 50;
  }

  async handleUserInput(sessionId: string, userInput: string): Promise<string> {
    logger.info(`Handling user input for session ${sessionId}`, { userInput });
    await this.deps.memoryManager.appendSessionMessage(
      sessionId,
      this.message("user", userInput),
    );

    let lastObservation: string | undefined;

    for (let i = 0; i < this.maxIterations; i += 1) {
      try {
        const session = await this.deps.memoryManager.getSession(sessionId);

        const allMemory = await this.deps.memoryManager.getLongTermMemory();
        const isBootstrapComplete = allMemory.some((m) => m.content === "bootstrap_complete");

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
          maxIterations: this.maxIterations,
          isBootstrapComplete,
        });

        const decision = await this.deps.llm.decide(userPrompt, systemPrompt);
        logger.info(`Agent Thought: ${decision.thought}`);
        logger.debug("Received decision from LLM", { type: decision.type, tool: decision.tool, skill: decision.skill });

        if (decision.type === "respond") {
          const finalMessage = decision.message ?? "";
          logger.info(`Agent responded for session ${sessionId}`, { message: finalMessage });

          await this.deps.memoryManager.appendSessionMessage(
            sessionId,
            this.message("assistant", finalMessage),
          );

          return finalMessage;
        }

        const result = await this.executor.executeDecision(sessionId, decision);
        logger.info(`Executed decision`, { type: decision.type, tool: decision.tool, skill: decision.skill });

        lastObservation = this.formatExecutionFeedback(decision, result);

        await this.deps.memoryManager.appendSessionMessage(
          sessionId,
          this.message("tool", lastObservation),
        );
      } catch (error) {
        logger.error(`Error in agent loop iteration ${i + 1} for session ${sessionId}`, { error: error instanceof Error ? error.message : String(error) });
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

    const fallback = "I could not finalize a response within iteration limits.";
    logger.warn(`Agent failed to respond within max iterations for session ${sessionId}`);

    await this.deps.memoryManager.appendSessionMessage(
      sessionId,
      this.message("assistant", fallback),
    );

    return fallback;
  }


  private formatExecutionFeedback(
    decision: AgentDecision,
    result: unknown,
  ): string {
    if (decision.type === "tool_call") {
      return `Tool ${decision.tool} result: ${this.stringify(result)}`;
    }
    if (decision.type === "skill_call") {
      return `Skill ${decision.skill} result: ${this.stringify(result)}`;
    }
    if (decision.type === "memory_write") {
      return `Memory write result: ${this.stringify(result)}`;
    }
    if (decision.type === "profile_write") {
      return `Profile write result: ${this.stringify(result)}`;
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
