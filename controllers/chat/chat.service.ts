import { AgentLoop } from "../../core/agent/agent-loop.js";
import { MemoryManager } from "../../managers/memory-manager.js";
import type { LlmAdapter } from "../../common/interfaces/types.js";

export interface ChatResponse {
  response: string;
  runId: string;
}

/** Strip JSON wrappers / quotes so titles store as plain text. */
export function normalizeGeneratedSessionTitle(raw: string, maxLength = 60): string {
  let text = raw.trim();

  const fenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  if (text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text) as { title?: unknown };
      if (typeof parsed.title === "string" && parsed.title.trim()) {
        text = parsed.title.trim();
      }
    } catch {
      const match = text.match(/"title"\s*:\s*"((?:\\.|[^"\\])*)"/);
      if (match) {
        text = match[1].replace(/\\"/g, '"').replace(/\\n/g, " ").trim();
      }
    }
  }

  text = text.replace(/^["']|["']$/g, "").replace(/\s+/g, " ").trim();
  return text.slice(0, maxLength);
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
    const hasUserMessages = session.messages.some((m: any) => m.role === "user");

    if (!hasUserMessages && !session.title) {
      // Fire-and-forget so it doesn't delay the chat response
      this.llm
        .complete(
          `User message: "${message}"`,
          `You generate ultra-short session titles. Given the user's first message, reply with ONLY plain text — 3 to 6 words that capture the topic. No JSON, no markdown, no punctuation, no quotes, no explanation.`,
        )
        .then((title) => {
          const clean = normalizeGeneratedSessionTitle(title);
          if (!clean) {
            throw new Error("Empty title from LLM");
          }
          return this.memoryManager.updateSessionTitle(sessionId, clean);
        })
        .catch(() => {
          // Fallback to truncated first message if LLM fails
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
