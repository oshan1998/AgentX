import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import { MemoryManager } from "../../managers/memory-manager.js";

export interface SessionSummary {
  id: string;
  title: string;
}

export interface SessionDetail {
  sessionId: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  messages: Array<{ role: string; content: string; createdAt: string }>;
}

/**
 * Encapsulates session-related business logic:
 * - listing all sessions
 * - creating a new session
 * - retrieving session history (filtered for UI consumption)
 */
export class SessionService {
  constructor(private readonly memoryManager: MemoryManager) {}

  /** List all sessions with their id and title. */
  async listSessions(): Promise<SessionSummary[]> {
    const sessionIds = await this.memoryManager.listRootSessions();

    const sessions = await Promise.all(
      sessionIds.map(async (id) => {
        try {
          const s = await this.memoryManager.getSession(id);
          return { id, title: s.title || id };
        } catch {
          return { id, title: id };
        }
      }),
    );

    return sessions;
  }

  /** Create a new empty session and return its id & title. */
  async createSession(): Promise<SessionSummary> {
    const newId = randomUUID();
    await this.memoryManager.getSession(newId); // initialises the file
    return { id: newId, title: newId };
  }

  /** Get session history filtered to user & assistant messages only. */
  async getSessionHistory(sessionId: string): Promise<SessionDetail> {
    const session = await this.memoryManager.getSession(sessionId);

    // Only user and assistant messages for UI
    const filteredMessages = session.messages.filter(
      (m: any) => m.role === "user" || m.role === "assistant",
    );

    return {
      sessionId: session.sessionId,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messages: filteredMessages,
    };
  }

  /** Get the task plan for a session. */
  async getSessionPlan(sessionId: string) {
    return this.memoryManager.readTaskPlan(sessionId);
  }
}
