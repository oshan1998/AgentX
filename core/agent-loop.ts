import type { SkillRegistry, ToolRegistry } from "../interfaces/registry.js";
import type {
  AgentDecision,
  LlmAdapter,
  Message,
} from "../interfaces/types.js";
import { Executor } from "./executor.js";
import { MemoryManager } from "./memory-manager.js";
import { PromptBuilder } from "./prompt-builder.js";

interface AgentLoopDependencies {
  llm: LlmAdapter;
  memoryManager: MemoryManager;
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
      deps.toolRegistry,
      deps.skillRegistry,
    );
    this.maxIterations = deps.maxIterations ?? 8;
  }

  async handleUserInput(sessionId: string, userInput: string): Promise<string> {
    await this.deps.memoryManager.appendSessionMessage(
      sessionId,
      this.message("user", userInput),
    );

    let lastObservation: string | undefined;

    for (let i = 0; i < this.maxIterations; i += 1) {
      try {
        const session = await this.deps.memoryManager.getSession(sessionId);

        const relevantLongTermMemory =
          await this.deps.memoryManager.searchLongTermMemory(userInput);

        const prompt = this.promptBuilder.build({
          latestUserMessage: userInput,
          session,
          relevantLongTermMemory,
          toolRegistry: this.deps.toolRegistry,
          skillRegistry: this.deps.skillRegistry,
          lastObservation,
          iteration: i + 1,
          maxIterations: this.maxIterations,
        });

        const decision = await this.deps.llm.decide(prompt);

        if (decision.type === "respond") {
          const finalMessage = decision.message ?? "";

          await this.deps.memoryManager.appendSessionMessage(
            sessionId,
            this.message("assistant", finalMessage),
          );

          return finalMessage;
        }

        const result = await this.executor.executeDecision(sessionId, decision);

        lastObservation = this.formatExecutionFeedback(decision, result);

        await this.deps.memoryManager.appendSessionMessage(
          sessionId,
          this.message("tool", lastObservation),
        );
      } catch (error) {
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

    await this.deps.memoryManager.appendSessionMessage(
      sessionId,
      this.message("assistant", fallback),
    );

    return fallback;
  }

  private buildPromptFromSession(
    session: any,
    latestUserMessage: string,
    relevantLongTermMemory: any[] = [],
  ): string {
    // Simple session history prompt builder
    const history = session.messages
      .map((msg: any) => `${msg.role}: ${msg.content}`)
      .join("\n");
    return `history: ${history}\nrelevantLongTermMemory: ${relevantLongTermMemory.join(", ")}\nlatestMessage: ${latestUserMessage}`;
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
