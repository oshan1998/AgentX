import { Auth } from "googleapis";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { Tool, Skill } from "../common/interfaces/types.js";
import { logger } from "../common/services/logger.js";
import type { Scored } from "./vector-manager.js";

export interface VertexRagManagerOptions {
  projectId: string;
  location?: string;
  storagePath: string;
  corpusDisplayName?: string;
}

interface VertexRagState {
  corpusName: string | null;
  toolFiles: Record<string, string>;   // tool.name  -> ragFile resource name
  skillFiles: Record<string, string>;  // skill.name -> ragFile resource name
  toolHashes: Record<string, string>;  // tool.name  -> md5 of (name+description)
  skillHashes: Record<string, string>;
}

const EMPTY_STATE: VertexRagState = {
  corpusName: null,
  toolFiles: {},
  skillFiles: {},
  toolHashes: {},
  skillHashes: {},
};

export class VertexRagManager {
  private readonly projectId: string;
  private readonly location: string;
  private readonly baseUrl: string;
  private readonly uploadBaseUrl: string;
  private readonly storagePath: string;
  private readonly corpusDisplayName: string;
  private state: VertexRagState = { ...EMPTY_STATE };
  private authClient: Auth.OAuth2Client | null = null;

  constructor(options: VertexRagManagerOptions) {
    this.projectId = options.projectId;
    this.location = options.location ?? "us-central1";
    this.storagePath = options.storagePath;
    this.corpusDisplayName = options.corpusDisplayName ?? "agentx-capabilities";
    this.baseUrl = `https://${this.location}-aiplatform.googleapis.com/v1beta1`;
    this.uploadBaseUrl = `https://${this.location}-aiplatform.googleapis.com/upload/v1beta1`;
  }

  async init(): Promise<void> {
    await mkdir(path.dirname(this.storagePath), { recursive: true });
    try {
      const raw = await readFile(this.storagePath, "utf-8");
      this.state = JSON.parse(raw) as VertexRagState;
      logger.info("[vertex-rag] loaded state", {
        corpus: this.state.corpusName,
        tools: Object.keys(this.state.toolFiles).length,
        skills: Object.keys(this.state.skillFiles).length,
      });
    } catch {
      this.state = { ...EMPTY_STATE };
    }

    await this.ensureCorpus();
  }

  async indexCapabilities(tools: Tool[], skills: Skill[]): Promise<void> {
    logger.info("[vertex-rag] indexing capabilities", {
      tools: tools.length,
      skills: skills.length,
    });

    let changed = false;

    for (const tool of tools) {
      const hash = this.hash(`${tool.name}${tool.description ?? ""}`);
      const hasIndexedFile = Boolean(this.state.toolFiles[tool.name]);
      if (this.state.toolHashes[tool.name] === hash && hasIndexedFile) continue;

      // Delete stale file if it exists
      if (this.state.toolFiles[tool.name]) {
        await this.deleteFile(this.state.toolFiles[tool.name]).catch(() => null);
      }

      const content = `${tool.name}\n${tool.description ?? ""}`;
      const filePath = await this.uploadFile(tool.name, content);
      this.state.toolFiles[tool.name] = filePath;
      this.state.toolHashes[tool.name] = hash;
      changed = true;
      logger.debug("[vertex-rag] uploaded tool", { tool: tool.name });
    }

    for (const skill of skills) {
      const hash = this.hash(`${skill.name}${skill.description ?? ""}`);
      const hasIndexedFile = Boolean(this.state.skillFiles[skill.name]);
      if (this.state.skillHashes[skill.name] === hash && hasIndexedFile) continue;

      if (this.state.skillFiles[skill.name]) {
        await this.deleteFile(this.state.skillFiles[skill.name]).catch(() => null);
      }

      const content = `${skill.name}\n${skill.description ?? ""}`;
      const filePath = await this.uploadFile(skill.name, content);
      this.state.skillFiles[skill.name] = filePath;
      this.state.skillHashes[skill.name] = hash;
      changed = true;
      logger.debug("[vertex-rag] uploaded skill", { skill: skill.name });
    }

    if (changed) await this.saveState();
  }

  async queryTools(
    userInput: string,
    allTools: Tool[],
    limit: number,
  ): Promise<Scored<Tool>[]> {
    const contexts = await this.retrieve(userInput, limit * 2);
    const toolByName = new Map(allTools.map((t) => [t.name, t]));
    const results: Scored<Tool>[] = [];

    for (const ctx of contexts) {
      const toolName = ctx.text.split("\n")[0].trim();
      const tool = toolByName.get(toolName);
      if (tool) results.push({ item: tool, score: ctx.score });
      if (results.length >= limit) break;
    }

    return results;
  }

  async querySkills(
    userInput: string,
    allSkills: Skill[],
    limit: number,
  ): Promise<Scored<Skill>[]> {
    const contexts = await this.retrieve(userInput, limit * 2);
    const skillByName = new Map(allSkills.map((s) => [s.name, s]));
    const results: Scored<Skill>[] = [];

    for (const ctx of contexts) {
      const skillName = ctx.text.split("\n")[0].trim();
      const skill = skillByName.get(skillName);
      if (skill) results.push({ item: skill, score: ctx.score });
      if (results.length >= limit) break;
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Private: corpus lifecycle
  // ---------------------------------------------------------------------------

  private async ensureCorpus(): Promise<void> {
    if (this.state.corpusName) {
      try {
        const resolved = await this.resolveCorpusName(this.state.corpusName);
        if (resolved !== this.state.corpusName) {
          this.state.corpusName = resolved;
          await this.saveState();
        }
        if (await this.corpusExists(resolved)) {
          logger.info("[vertex-rag] reusing corpus", { corpus: resolved });
          return;
        }
        logger.warn("[vertex-rag] stored corpus not found, recreating", { corpus: resolved });
      } catch (err) {
        logger.warn("[vertex-rag] stored corpus invalid, recreating", { error: String(err) });
      }
      this.resetCorpusState();
    }

    logger.info("[vertex-rag] creating corpus", { displayName: this.corpusDisplayName });
    const { res, body } = await this.requestJson<Record<string, unknown>>(
      `${this.baseUrl}/projects/${this.projectId}/locations/${this.location}/ragCorpora`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: this.corpusDisplayName }),
      },
    );

    if (!res.ok) {
      throw new Error(`[vertex-rag] corpus creation failed: ${JSON.stringify(body)}`);
    }

    const corpusName = await this.resolveCorpusName(body.name as string);
    this.state.corpusName = corpusName;
    await this.saveState();
    logger.info("[vertex-rag] corpus created", { corpus: corpusName });
  }

  private resetCorpusState(): void {
    this.state.corpusName = null;
    this.state.toolFiles = {};
    this.state.skillFiles = {};
    this.state.toolHashes = {};
    this.state.skillHashes = {};
  }

  private isRagCorpusName(name: string): boolean {
    return name.includes("/ragCorpora/");
  }

  private isOperationName(name: string): boolean {
    return name.includes("/operations/");
  }

  private async resolveCorpusName(name: string): Promise<string> {
    if (this.isRagCorpusName(name)) return name;
    if (this.isOperationName(name)) return this.waitForOperation(name);
    throw new Error(`[vertex-rag] unknown resource format: ${name}`);
  }

  private async waitForOperation(operationName: string): Promise<string> {
    const maxAttempts = 60;
    const delayMs = 2000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const { res, body } = await this.requestJson<Record<string, unknown>>(
        `${this.baseUrl}/${operationName}`,
      );
      if (!res.ok) {
        throw new Error(`[vertex-rag] operation poll failed: ${JSON.stringify(body)}`);
      }

      if (body.done) {
        if (body.error) {
          throw new Error(`[vertex-rag] operation failed: ${JSON.stringify(body.error)}`);
        }
        const response = body.response as Record<string, unknown> | undefined;
        const corpusName = response?.name as string | undefined;
        if (!corpusName || !this.isRagCorpusName(corpusName)) {
          throw new Error(
            `[vertex-rag] operation completed without corpus: ${JSON.stringify(body)}`,
          );
        }
        return corpusName;
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    throw new Error(`[vertex-rag] operation timed out: ${operationName}`);
  }

  private async corpusExists(corpusName: string): Promise<boolean> {
    const { res } = await this.requestJson(`${this.baseUrl}/${corpusName}`);
    return res.ok;
  }

  // ---------------------------------------------------------------------------
  // Private: file operations
  // ---------------------------------------------------------------------------

  private async uploadFile(displayName: string, content: string): Promise<string> {
    const token = await this.getToken();
    const boundary = "agentx_boundary_" + Date.now();

    const metadata = JSON.stringify({
      ragFile: { displayName },
    });
    const body = [
      `--${boundary}`,
      "Content-Type: application/json",
      "",
      metadata,
      `--${boundary}`,
      "Content-Type: text/plain",
      "",
      content,
      `--${boundary}--`,
    ].join("\r\n");

    const res = await fetch(
      `${this.uploadBaseUrl}/projects/${this.projectId}/locations/${this.location}/ragCorpora/${this.corpusId}/ragFiles:upload`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
          "X-Goog-Upload-Protocol": "multipart",
        },
        body,
      },
    );

    const responseBody = await this.parseResponseJson(res);
    if (!res.ok) {
      throw new Error(`[vertex-rag] file upload failed for "${displayName}": ${JSON.stringify(responseBody)}`);
    }

    const ragFile = responseBody.ragFile as { name?: string } | undefined;
    const fileName = ragFile?.name ?? (responseBody.name as string | undefined);
    if (!fileName) {
      throw new Error(
        `[vertex-rag] file upload for "${displayName}" returned no resource name: ${JSON.stringify(responseBody)}`,
      );
    }

    return fileName;
  }

  private async deleteFile(filePath: string): Promise<void> {
    const token = await this.getToken();
    await fetch(`${this.baseUrl}/${filePath}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  // ---------------------------------------------------------------------------
  // Private: retrieval
  // ---------------------------------------------------------------------------

  private async retrieve(
    query: string,
    topK: number,
  ): Promise<{ text: string; score: number }[]> {
    if (!this.state.corpusName) return [];

    const { res, body } = await this.requestJson<{
      contexts?: { contexts?: { text?: string; score?: number }[] };
    }>(
      `${this.baseUrl}/projects/${this.projectId}/locations/${this.location}:retrieveContexts`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vertexRagStore: {
            ragResources: [{ ragCorpus: this.state.corpusName }],
          },
          query: {
            text: query,
            ragRetrievalConfig: { topK },
          },
        }),
      },
    );

    if (!res.ok) {
      throw new Error(`[vertex-rag] retrieve failed: ${JSON.stringify(body)}`);
    }

    const ctxs = body.contexts?.contexts ?? [];

    return ctxs
      .filter((c) => c.text)
      .map((c) => ({ text: c.text!, score: c.score ?? 0 }));
  }

  // ---------------------------------------------------------------------------
  // Private: auth & utils
  // ---------------------------------------------------------------------------

  private async getToken(): Promise<string> {
    if (!this.authClient) {
      const auth = new Auth.GoogleAuth({
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
      });
      this.authClient = (await auth.getClient()) as Auth.OAuth2Client;
    }
    const token = await this.authClient.getAccessToken();
    if (!token.token) throw new Error("[vertex-rag] failed to get access token");
    return token.token;
  }

  private async requestJson<T extends Record<string, unknown> = Record<string, unknown>>(
    url: string,
    init?: RequestInit,
  ): Promise<{ res: Response; body: T }> {
    const token = await this.getToken();
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...init?.headers,
      },
    });
    const body = await this.parseResponseJson(res) as T;
    return { res, body };
  }

  private async parseResponseJson(res: Response): Promise<Record<string, unknown>> {
    const text = await res.text();
    if (!text) return {};

    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      const snippet = text.replace(/\s+/g, " ").slice(0, 200);
      throw new Error(
        `[vertex-rag] expected JSON from ${res.url} (HTTP ${res.status}) but got: ${snippet}`,
      );
    }
  }

  private get corpusId(): string {
    // corpus name format: projects/.../locations/.../ragCorpora/{id}
    return this.state.corpusName!.split("/").pop()!;
  }

  private hash(text: string): string {
    return crypto.createHash("md5").update(text).digest("hex");
  }

  private async saveState(): Promise<void> {
    await writeFile(this.storagePath, JSON.stringify(this.state, null, 2), "utf-8");
  }
}
