import { AgentLoop } from "../../core/agent/agent-loop.js";
import { MemoryManager } from "../../managers/memory-manager.js";
import type { LlmAdapter } from "../../common/interfaces/types.js";

export interface ChatResponse {
  response: string;
  runId: string;
}

/**
 * Encapsulates chat business logic:
 * - auto-generating session titles on the first message
 * - delegating to the AgentLoop (agent decides when to use tools/skills, including RAG)
 */
export class ChatService {
  constructor(
    private readonly agentLoop: AgentLoop,
    private readonly memoryManager: MemoryManager,
    private readonly llm: LlmAdapter,
  ) {}

  cancelRun(runId: string): boolean {
    return this.agentLoop.cancelRun(runId);
  }

  async handleMessage(
    sessionId: string,
    message: string,
    runId: string,
    abortSignal?: AbortSignal,
  ): Promise<ChatResponse> {
    const session = await this.memoryManager.getSession(sessionId);
    const hasUserMessages = session.messages.some((m: { role: string }) => m.role === "user");

    if (!hasUserMessages && !session.title) {
      this.llm
        .complete(
          `User message: "${message}"`,
          `You generate ultra-short session titles. Given the user's first message, reply with ONLY a title of 3 to 6 words that captures the topic. No punctuation, no quotes, no explanation. Just the title.`,
        )
        .then((title) => {
          const clean = title.trim().replace(/^["']|["']$/g, "").slice(0, 60);
          return this.memoryManager.updateSessionTitle(sessionId, clean);
        })
        .catch(() => {
          const words = message.trim().split(/\s+/).slice(0, 6).join(" ");
          const fallback = words.length > 40 ? words.slice(0, 40) + "…" : words;
          return this.memoryManager.updateSessionTitle(sessionId, fallback);
        });
    }

    const response = await this.agentLoop.handleUserInput(sessionId, message, {
      runId,
      abortSignal,
    });
    return { response, runId };
  }
}
