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
  cancelRun(runId: string): boolean {
    return this.agentLoop.cancelRun(runId);
  }

  async handleMessage(
    sessionId: string,
    message: string,
    runId: string,
    abortSignal?: AbortSignal,
  ): Promise<ChatResponse> {
    // Auto-generate title from the first user message using LLM
    const session = await this.memoryManager.getSession(sessionId);
    const hasUserMessages = session.messages.some(
      (m: any) => m.role === "user",
    );

    if (!hasUserMessages && !session.title) {
      // Fire-and-forget so it doesn't delay the chat response
      this.llm
        .complete(
          `User message: "${message}"`,
          `You generate ultra-short session titles.

Given the user's first message, reply with ONLY a title of 3 to 6 words that captures the topic.

Rules:
- No punctuation
- No quotes
- No prefixes like "Title:"
- No explanation
- No extra words outside the title

Examples:
User message: "how to debug node memory leak"
Title: Node memory leak debugging

User message: "bitcoin whitepaper explanation"
Title: Bitcoin whitepaper explanation
`,
        )
        .then((title) => {
          let clean = normalizeTitle(title);
          clean = enforceWordLimit(clean);

          if (!isValidTitle(clean)) {
            clean = generateFallbackTitle(message);
          }

          return this.memoryManager.updateSessionTitle(sessionId, clean);
        })
        .catch(() => {
          const fallback = generateFallbackTitle(message);
          return this.memoryManager.updateSessionTitle(sessionId, fallback);
        });
    }

    /**
     * -----------------------------
     * Helpers
     * -----------------------------
     */

    function normalizeTitle(raw: string): string {
      return raw
        .trim()
        .replace(/^title\s*:\s*/i, "")
        .replace(/^["'`]+|["'`]+$/g, "")
        .replace(/\.$/, "")
        .replace(/\s+/g, " ");
    }

    function enforceWordLimit(title: string): string {
      const words = title.split(" ").filter(Boolean);
      return words.slice(0, 6).join(" ");
    }

    function isValidTitle(title: string): boolean {
      const words = title.trim().split(/\s+/).filter(Boolean);
      return words.length >= 3 && words.length <= 6;
    }

    function generateFallbackTitle(message: string): string {
      const words = message
        .trim()
        .replace(/[^\w\s]/g, "") // remove punctuation
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 6);

      let fallback = words.join(" ");

      // ensure minimum readability
      if (fallback.split(" ").length < 3) {
        fallback = words.slice(0, 6).join(" ");
      }

      return fallback;
    }

    const response = await this.agentLoop.handleUserInput(sessionId, message, {
      runId,
      abortSignal,
    });
    return { response, runId };
  }
}
