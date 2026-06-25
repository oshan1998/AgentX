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
  PatchTaskPlanTaskInput,
  taskPlanDocumentSchema,
  taskPlanItemSchema,
  type TaskPlanDocument,
  type TaskPlanItem,
} from "../common/services/task-plan-schema.js";
import { VectorManager } from "./vector-manager.js";
import { logger } from "../common/services/logger.js";

function parseLegacyTaskPlanArray(parsed: unknown): TaskPlanItem[] | null {
  const r = z.array(taskPlanItemSchema).safeParse(parsed);
  return r.success ? r.data : null;
}

export class MemoryManager {
  constructor(
    private readonly basePath: string,
    private readonly vectorManager?: VectorManager,
    private readonly sessionsDir = "sessions",
    private readonly longTermFile = "long-term.json",
  ) {}

  /** Map of rootSessionId -> last plan update promise (sequential lock) */
  private readonly planLocks = new Map<string, Promise<any>>();

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

    if (this.vectorManager) {
      const allEntries = await this.getLongTermMemory();
      let hasNewEmbeddings = false;
      for (const entry of allEntries) {
        if (!this.vectorManager.getMemoryEmbedding(entry.id)) {
          logger.info(`Generating missing embedding for long-term memory entry ${entry.id}`);
          try {
            const text = `Memory Type: ${entry.type}. Content: ${entry.content}`;
            const embedding = await this.vectorManager.getDocumentEmbedding(text);
            this.vectorManager.setMemoryEmbedding(entry.id, embedding);
            hasNewEmbeddings = true;
          } catch (err) {
            logger.error(`Failed to index memory entry ${entry.id} during initialization`, { error: err });
          }
        }
      }
      if (hasNewEmbeddings) {
        await this.vectorManager.save();
      }
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

    if (this.vectorManager) {
      try {
        const text = `Memory Type: ${finalEntry.type}. Content: ${finalEntry.content}`;
        const embedding = await this.vectorManager.getDocumentEmbedding(text);
        this.vectorManager.setMemoryEmbedding(finalEntry.id, embedding);
        await this.vectorManager.save();
      } catch (err) {
        logger.error(`Failed to generate embedding for new long-term memory ${finalEntry.id}`, { error: err });
      }
    }

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

  async patchTaskPlanTask(
    sessionId: string,
    patch: PatchTaskPlanTaskInput,
  ): Promise<TaskPlanDocument> {
    const rootId = await this.resolveTaskPlanSessionId(sessionId);
    
    // Serialize updates for this session to prevent read-modify-write race conditions
    const currentLock = this.planLocks.get(rootId) || Promise.resolve();
    const nextLock = currentLock.then(async () => {
      const doc = (await this.readTaskPlan(rootId)) ?? {
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
        tasks: [],
      };

      const existingIndex = doc.tasks.findIndex((t) => t.id === patch.id);
      const existing = existingIndex !== -1 ? doc.tasks[existingIndex] : undefined;
      const merged = this.mergeTaskPlanItem(existing, patch);

      const nextTasks = existingIndex !== -1
        ? doc.tasks.map((t, i) => (i === existingIndex ? merged : t))
        : [...doc.tasks, merged];

      const next: TaskPlanDocument = {
        ...doc,
        updatedAt: new Date().toISOString(),
        tasks: nextTasks,
      };

      await this.writeTaskPlan(rootId, next);
      return next;
    });

    this.planLocks.set(rootId, nextLock);
    
    // Clean up map entry when promise settled to avoid long-term memory growth
    nextLock.catch(() => {}).finally(() => {
      if (this.planLocks.get(rootId) === nextLock) {
        this.planLocks.delete(rootId);
      }
    });

    return nextLock;
  }

  private mergeTaskPlanItem(
    existing: TaskPlanItem | undefined,
    patch: PatchTaskPlanTaskInput,
  ): TaskPlanItem {
    const title = patch.title ?? existing?.title;
    const notes = patch.notes !== undefined ? (patch.notes.length > 0 ? patch.notes : undefined) : existing?.notes;
    const artifact_path = patch.artifact_path !== undefined ? (patch.artifact_path.length > 0 ? patch.artifact_path : undefined) : existing?.artifact_path;
    const instruction = patch.instruction !== undefined ? (patch.instruction.length > 0 ? patch.instruction : undefined) : existing?.instruction;
    
    let blocked_reason: string | undefined;
    if (patch.blocked_reason !== undefined) {
      blocked_reason = patch.blocked_reason;
    } else if (patch.status === "blocked") {
      blocked_reason = existing?.blocked_reason;
    }

    const item: TaskPlanItem = {
      id: patch.id,
      status: patch.status,
    };

    if (title) item.title = title;
    if (notes) item.notes = notes;
    if (artifact_path) item.artifact_path = artifact_path;
    if (blocked_reason) item.blocked_reason = blocked_reason;
    if (instruction) item.instruction = instruction;

    if (existing?.depends_on) item.depends_on = existing.depends_on;
    if (existing?.tool_names) item.tool_names = existing.tool_names;
    if (existing?.skill_names) item.skill_names = existing.skill_names;

    return item;
  }

  async searchLongTermMemory(query: string, limit = 5): Promise<LongTermMemoryEntry[]> {
    const allEntries = await this.getLongTermMemory();
    if (allEntries.length === 0) {
      return [];
    }

    if (this.vectorManager) {
      try {
        const queryEmbedding = await this.vectorManager.getQueryEmbedding(query);
        return this.vectorManager.searchMemories(queryEmbedding, allEntries, limit);
      } catch (err) {
        logger.warn(`Vector search failed for long-term memory query "${query}". Falling back to keyword search.`, { error: err });
      }
    }

    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      return allEntries.slice(0, limit);
    }

    return allEntries.filter((item) => {
      const text = `${item.type} ${item.content}`.toLowerCase();
      return tokens.some((t) => text.includes(t));
    }).slice(0, limit);
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
