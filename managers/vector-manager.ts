import { GoogleGenAI } from "@google/genai";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { Tool, Skill, LongTermMemoryEntry } from "../common/interfaces/types.js";
import { logger } from "../common/services/logger.js";

export interface VectorManagerOptions {
  projectId: string;
  location?: string;
  storagePath: string;
}

interface VectorStoreData {
  capabilities: Record<string, number[]>; // hash -> embedding
  memories: Record<string, number[]>;     // memoryId -> embedding
}

export class VectorManager {
  private readonly client: GoogleGenAI;
  private readonly storagePath: string;
  private data: VectorStoreData = { capabilities: {}, memories: {} };

  // In-memory mappings from tool/skill name to their active embedding
  private toolEmbeddings = new Map<string, number[]>();
  private skillEmbeddings = new Map<string, number[]>();

  constructor(options: VectorManagerOptions) {
    this.storagePath = options.storagePath;
    this.client = new GoogleGenAI({
      vertexai: true,
      project: options.projectId,
      location: options.location || "us-central1",
    });
  }

  async init(): Promise<void> {
    const dir = path.dirname(this.storagePath);
    await mkdir(dir, { recursive: true });

    try {
      const raw = await readFile(this.storagePath, "utf-8");
      const parsed = JSON.parse(raw);
      this.data = {
        capabilities: parsed.capabilities || {},
        memories: parsed.memories || {},
      };
      logger.info(`Loaded vector store from ${this.storagePath}. Loaded ${Object.keys(this.data.memories).length} memory embeddings.`);
    } catch {
      this.data = { capabilities: {}, memories: {} };
      await this.save();
      logger.info(`Initialized empty vector store at ${this.storagePath}`);
    }
  }

  async getEmbedding(text: string): Promise<number[]> {
    try {
      const response = await this.client.models.embedContent({
        model: "text-embedding-004",
        contents: text,
      });

      if (!response.embeddings?.[0]?.values) {
        throw new Error("No embedding values returned from Vertex AI.");
      }

      return response.embeddings[0].values;
    } catch (error) {
      logger.error(`Failed to generate embedding for text: "${text.substring(0, 50)}..."`, { error });
      throw error;
    }
  }

  setMemoryEmbedding(id: string, embedding: number[]): void {
    this.data.memories[id] = embedding;
  }

  deleteMemoryEmbedding(id: string): void {
    delete this.data.memories[id];
  }

  getMemoryEmbedding(id: string): number[] | undefined {
    return this.data.memories[id];
  }

  async save(): Promise<void> {
    await writeFile(this.storagePath, JSON.stringify(this.data, null, 2), "utf-8");
  }

  /**
   * Pre-generates or retrieves cached embeddings for all registered tools and skills.
   */
  async indexCapabilities(tools: Tool[], skills: Skill[]): Promise<void> {
    logger.info(`Indexing capabilities: ${tools.length} tools, ${skills.length} skills`);
    
    this.toolEmbeddings.clear();
    this.skillEmbeddings.clear();

    const newCapabilitiesCache: Record<string, number[]> = {};
    let cacheHits = 0;
    let apiCalls = 0;

    // Index Tools
    for (const tool of tools) {
      const text = `Tool: ${tool.name}. Description: ${tool.description || ""}`;
      const hash = this.getHash(text);
      
      let embedding = this.data.capabilities[hash];
      if (embedding) {
        cacheHits++;
      } else {
        logger.debug(`Cache miss for tool: ${tool.name}. Generating embedding...`);
        embedding = await this.getEmbedding(text);
        apiCalls++;
      }

      newCapabilitiesCache[hash] = embedding;
      this.toolEmbeddings.set(tool.name, embedding);
    }

    // Index Skills
    for (const skill of skills) {
      const text = `Skill: ${skill.name}. Description: ${skill.description || ""}`;
      const hash = this.getHash(text);

      let embedding = this.data.capabilities[hash];
      if (embedding) {
        cacheHits++;
      } else {
        logger.debug(`Cache miss for skill: ${skill.name}. Generating embedding...`);
        embedding = await this.getEmbedding(text);
        apiCalls++;
      }

      newCapabilitiesCache[hash] = embedding;
      this.skillEmbeddings.set(skill.name, embedding);
    }

    // Update active data structure with current active capabilities
    this.data.capabilities = newCapabilitiesCache;
    
    if (apiCalls > 0) {
      await this.save();
    }

    logger.info(`Capabilities indexing complete. Cache hits: ${cacheHits}, API calls: ${apiCalls}`);
  }

  searchTools(queryEmbedding: number[], tools: Tool[], limit: number): Tool[] {
    const scored = tools
      .map((tool) => {
        const emb = this.toolEmbeddings.get(tool.name);
        if (!emb) return { tool, score: -1 };
        return { tool, score: this.cosineSimilarity(queryEmbedding, emb) };
      })
      .filter((item) => item.score >= 0)
      .sort((a, b) => b.score - a.score);

    return scored.slice(0, limit).map((item) => item.tool);
  }

  searchSkills(queryEmbedding: number[], skills: Skill[], limit: number): Skill[] {
    const scored = skills
      .map((skill) => {
        const emb = this.skillEmbeddings.get(skill.name);
        if (!emb) return { skill, score: -1 };
        return { skill, score: this.cosineSimilarity(queryEmbedding, emb) };
      })
      .filter((item) => item.score >= 0)
      .sort((a, b) => b.score - a.score);

    return scored.slice(0, limit).map((item) => item.skill);
  }

  searchMemories(queryEmbedding: number[], memories: LongTermMemoryEntry[], limit: number): LongTermMemoryEntry[] {
    const scored = memories
      .map((memory) => {
        const emb = this.data.memories[memory.id];
        if (!emb) return { memory, score: -1 };
        return { memory, score: this.cosineSimilarity(queryEmbedding, emb) };
      })
      .filter((item) => item.score >= 0)
      .sort((a, b) => b.score - a.score);

    return scored.slice(0, limit).map((item) => item.memory);
  }

  private getHash(text: string): string {
    return crypto.createHash("md5").update(text).digest("hex");
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    // Normalized vectors (e.g. text-embedding-004 outputs are unit length)
    // mean cosine similarity is just the dot product
    let dot = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
    }
    return dot;
  }
}
