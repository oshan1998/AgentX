import { AgentLoop } from "../../core/agent-loop.js";
import { MemoryManager } from "../../managers/memory-manager.js";
import type { LlmAdapter } from "../../interfaces/types.js";

export interface ChatResponse {
  response: string;
}

/**
 * Encapsulates chat business logic:
 * - auto-generating session titles on the first message
 * - delegating to the AgentLoop for actual processing
 */
export class ChatService {
  constructor(
    private readonly agentLoop: AgentLoop,
    private readonly memoryManager: MemoryManager,
    private readonly llm: LlmAdapter,
  ) {}

  /**
   * Process a user chat message.
   * Automatically generates a session title from the first user message.
   */
  async handleMessage(sessionId: string, message: string): Promise<ChatResponse> {
    // Auto-generate title from the first user message using LLM
    const session = await this.memoryManager.getSession(sessionId);
    const hasUserMessages = session.messages.some((m: any) => m.role === "user");

    if (!hasUserMessages && !session.title) {
      // Fire-and-forget so it doesn't delay the chat response
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
          // Fallback to truncated first message if LLM fails
          const words = message.trim().split(/\s+/).slice(0, 6).join(" ");
          const fallback = words.length > 40 ? words.slice(0, 40) + "…" : words;
          return this.memoryManager.updateSessionTitle(sessionId, fallback);
        });
    }

    const response = await this.agentLoop.handleUserInput(sessionId, message);
    return { response };
  }
}
