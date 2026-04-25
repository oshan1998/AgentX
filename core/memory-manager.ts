import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { LongTermMemoryEntry, Message, SessionMemory } from "../interfaces/types.js";

export class MemoryManager {
  constructor(
    private readonly basePath: string,
    private readonly sessionsDir = "sessions",
    private readonly longTermFile = "long-term.json"
  ) {}

  async init(): Promise<void> {
    await mkdir(this.getSessionsPath(), { recursive: true });
    await mkdir(this.basePath, { recursive: true });
    try {
      await readFile(this.getLongTermPath(), "utf-8");
    } catch {
      await writeFile(this.getLongTermPath(), JSON.stringify([], null, 2), "utf-8");
    }
  }

  async getSession(sessionId: string): Promise<SessionMemory> {
    const sessionPath = this.getSessionPath(sessionId);
    try {
      const raw = await readFile(sessionPath, "utf-8");
      return JSON.parse(raw) as SessionMemory;
    } catch {
      const now = new Date().toISOString();
      const freshSession: SessionMemory = {
        sessionId,
        createdAt: now,
        updatedAt: now,
        messages: []
      };
      await this.saveSession(freshSession);
      return freshSession;
    }
  }

  async appendSessionMessage(sessionId: string, message: Message): Promise<void> {
    const session = await this.getSession(sessionId);
    session.messages.push(message);
    session.updatedAt = new Date().toISOString();
    await this.saveSession(session);
  }

  async getLongTermMemory(): Promise<LongTermMemoryEntry[]> {
    const raw = await readFile(this.getLongTermPath(), "utf-8");
    return JSON.parse(raw) as LongTermMemoryEntry[];
  }

  async addLongTermMemory(entry: Omit<LongTermMemoryEntry, "id" | "createdAt">): Promise<LongTermMemoryEntry> {
    const allEntries = await this.getLongTermMemory();
    const finalEntry: LongTermMemoryEntry = {
      ...entry,
      id: randomUUID(),
      createdAt: new Date().toISOString()
    };
    allEntries.push(finalEntry);
    await writeFile(this.getLongTermPath(), JSON.stringify(allEntries, null, 2), "utf-8");
    return finalEntry;
  }

  async searchLongTermMemory(query: string): Promise<LongTermMemoryEntry[]> {
    const q = query.toLowerCase();
    const allEntries = await this.getLongTermMemory();
    return allEntries.filter((item) =>
      `${item.type} ${item.content}`.toLowerCase().includes(q)
    );
  }

  private async saveSession(session: SessionMemory): Promise<void> {
    await writeFile(this.getSessionPath(session.sessionId), JSON.stringify(session, null, 2), "utf-8");
  }

  private getSessionPath(sessionId: string): string {
    return path.join(this.getSessionsPath(), `${sessionId}.json`);
  }

  private getSessionsPath(): string {
    return path.join(this.basePath, this.sessionsDir);
  }

  private getLongTermPath(): string {
    return path.join(this.basePath, this.longTermFile);
  }
}
