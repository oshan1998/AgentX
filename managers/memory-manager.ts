import { mkdir, readFile, writeFile } from "node:fs/promises";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  LongTermMemoryEntry,
  Message,
  SessionMemory,
} from "../common/interfaces/types.js";
import { z } from "zod";
import {
  taskPlanDocumentSchema,
  taskPlanItemSchema,
  type TaskPlanDocument,
  type TaskPlanItem,
} from "../common/services/task-plan-schema.js";

function parseLegacyTaskPlanArray(parsed: unknown): TaskPlanItem[] | null {
  const r = z.array(taskPlanItemSchema).safeParse(parsed);
  return r.success ? r.data : null;
}

export class MemoryManager {
  constructor(
    private readonly basePath: string,
    private readonly sessionsDir = "sessions",
    private readonly longTermFile = "long-term.json",
  ) {}

  async init(): Promise<void> {
    await mkdir(this.getSessionsPath(), { recursive: true });
    await mkdir(this.basePath, { recursive: true });
    try {
      await readFile(this.getLongTermPath(), "utf-8");
    } catch {
      await writeFile(
        this.getLongTermPath(),
        JSON.stringify([], null, 2),
        "utf-8",
      );
    }
  }

  /**
   * For task-plan files: delegated sub-sessions use the root session id so the
   * principal chat owns one plan file in its directory.
   */
  async resolveTaskPlanSessionId(sessionId: string): Promise<string> {
    return sessionId.split("::")[0];
  }

  async getSession(sessionId: string): Promise<SessionMemory> {
    const sessionPath = await this.getSessionPath(sessionId);
    try {
      const raw = await readFile(sessionPath, "utf-8");
      return JSON.parse(raw) as SessionMemory;
    } catch {
      const now = new Date().toISOString();
      const freshSession: SessionMemory = {
        sessionId,
        createdAt: now,
        updatedAt: now,
        messages: [],
      };
      await this.saveSession(freshSession);
      return freshSession;
    }
  }

  async appendSessionMessage(
    sessionId: string,
    message: Message,
  ): Promise<void> {
    const session = await this.getSession(sessionId);
    session.messages.push(message);
    session.updatedAt = new Date().toISOString();
    await this.saveSession(session);
  }

  async updateSessionTitle(
    sessionId: string,
    title: string,
  ): Promise<void> {
    const session = await this.getSession(sessionId);
    session.title = title;
    session.updatedAt = new Date().toISOString();
    await this.saveSession(session);
  }

  /** 
   * Child session persisted in `subs/` subdirectory of the root session.
   * Uses naming convention `rootId::sub_<uuid>`.
   */
  async createChildSession(parentSessionId: string): Promise<string> {
    const rootId = await this.resolveTaskPlanSessionId(parentSessionId);
    const sessionId = `${rootId}::sub_${randomUUID()}`;
    const now = new Date().toISOString();
    const session: SessionMemory = {
      sessionId,
      parentSessionId,
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    await this.saveSession(session);
    return sessionId;
  }

  /** List all root session IDs (directories in memory/sessions). */
  async listRootSessions(): Promise<string[]> {
    const sessionsDir = this.getSessionsPath();
    try {
      const entries = await fs.readdir(sessionsDir, { withFileTypes: true });
      return entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      return [];
    }
  }

  async getLongTermMemory(): Promise<LongTermMemoryEntry[]> {
    const raw = await readFile(this.getLongTermPath(), "utf-8");
    return JSON.parse(raw) as LongTermMemoryEntry[];
  }

  async addLongTermMemory(
    entry: Omit<LongTermMemoryEntry, "id" | "createdAt">,
  ): Promise<LongTermMemoryEntry> {
    const allEntries = await this.getLongTermMemory();
    const finalEntry: LongTermMemoryEntry = {
      ...entry,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    allEntries.push(finalEntry);
    await writeFile(
      this.getLongTermPath(),
      JSON.stringify(allEntries, null, 2),
      "utf-8",
    );
    return finalEntry;
  }

  /**
   * Session-scoped task plan at `memory/sessions/<rootId>/task-plan.json`.
   */
  async readTaskPlan(sessionId: string): Promise<TaskPlanDocument | null> {
    try {
      const planPath = await this.getTaskPlanPath(sessionId);
      const raw = await readFile(planPath, "utf-8");
      const parsed: unknown = JSON.parse(raw);
      const doc = taskPlanDocumentSchema.safeParse(parsed);
      if (doc.success) {
        return doc.data;
      }
      if (Array.isArray(parsed)) {
        const tasks = parseLegacyTaskPlanArray(parsed);
        if (tasks) {
          return {
            schemaVersion: 1,
            updatedAt: new Date().toISOString(),
            tasks,
          };
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  async writeTaskPlan(sessionId: string, doc: TaskPlanDocument): Promise<void> {
    const normalized: TaskPlanDocument = {
      ...doc,
      updatedAt: doc.updatedAt,
    };
    await writeFile(
      await this.getTaskPlanPath(sessionId),
      JSON.stringify(normalized, null, 2),
      "utf-8",
    );
  }

  async searchLongTermMemory(query: string): Promise<LongTermMemoryEntry[]> {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);

    const allEntries = await this.getLongTermMemory();

    if (tokens.length === 0) {
      return allEntries;
    }

    return allEntries.filter((item) => {
      const text = `${item.type} ${item.content}`.toLowerCase();
      return tokens.some((t) => text.includes(t));
    });
  }

  private async saveSession(session: SessionMemory): Promise<void> {
    const sessionPath = await this.getSessionPath(session.sessionId);
    const dir = path.dirname(sessionPath);
    await mkdir(dir, { recursive: true });
    await writeFile(
      sessionPath,
      JSON.stringify(session, null, 2),
      "utf-8",
    );
  }

  private async getSessionPath(sessionId: string): Promise<string> {
    const parts = sessionId.split("::");
    const rootId = parts[0];
    const sessionsDir = this.getSessionsPath();
    
    if (parts.length === 1) {
      // Root session: memory/sessions/root/main.json
      return path.join(sessionsDir, rootId, "main.json");
    } else {
      // Sub session: memory/sessions/root/subs/sub_uuid.json
      const subId = parts[1];
      return path.join(sessionsDir, rootId, "subs", `${subId}.json`);
    }
  }

  private async getTaskPlanPath(sessionId: string): Promise<string> {
    const rootId = await this.resolveTaskPlanSessionId(sessionId);
    return path.join(this.getSessionsPath(), rootId, "task-plan.json");
  }

  private getSessionsPath(): string {
    return path.join(this.basePath, this.sessionsDir);
  }

  private getLongTermPath(): string {
    return path.join(this.basePath, this.longTermFile);
  }
}
