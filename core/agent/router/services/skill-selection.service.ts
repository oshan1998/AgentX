import type { SkillRegistry } from "../../../../common/interfaces/registry.js";
import type { LlmAdapter, Skill } from "../../../../common/interfaces/types.js";
import { logger } from "../../../../common/services/logger.js";
import type { Scored, VectorManager } from "../../../../managers/vector-manager.js";
import type { VertexRagManager } from "../../../../managers/vertex-rag-manager.js";
import {
  DEFAULT_RETRIEVED_SKILL_LIMIT,
  resolveCapabilityRetrievalMethod,
  type CapabilityRetrievalMethod,
} from "../../capability-retriever.js";
import {
  formatCatalogLines,
  normalizeNameList,
  resolveNamesToScored,
} from "./catalog-selection.utils.js";

export interface SkillSelectionParams {
  userInput: string;
  llm: LlmAdapter;
  skillRegistry: SkillRegistry;
  vectorManager?: VectorManager;
  vertexRagManager?: VertexRagManager;
  capabilityRetrievalMethod?: CapabilityRetrievalMethod;
}

export class SkillSelectionService {
  async select(params: SkillSelectionParams): Promise<Scored<Skill>[]> {
    const allSkills = params.skillRegistry.list();
    const limit = DEFAULT_RETRIEVED_SKILL_LIMIT;
    const method = resolveCapabilityRetrievalMethod(params.capabilityRetrievalMethod);

    if (method === "vertex_rag") {
      if (!params.vertexRagManager) {
        logger.warn("vertex_rag skill selection requested but no VertexRagManager — falling back to LLM.");
        return this.selectViaLlm(params, allSkills, limit);
      }
      return params.vertexRagManager.querySkills(params.userInput, allSkills, limit);
    }

    if (method === "rag") {
      if (!params.vectorManager) {
        logger.warn("RAG skill selection requested but no VectorManager — falling back to LLM.");
        return this.selectViaLlm(params, allSkills, limit);
      }
      return this.selectViaRag(params, allSkills, limit);
    }

    try {
      return await this.selectViaLlm(params, allSkills, limit);
    } catch (err) {
      if (!params.vectorManager) throw err;
      logger.warn("LLM skill selection failed; falling back to RAG.", { error: err });
      return this.selectViaRag(params, allSkills, limit);
    }
  }

  private async selectViaRag(
    params: SkillSelectionParams,
    allSkills: Skill[],
    limit: number,
  ): Promise<Scored<Skill>[]> {
    if (!params.vectorManager) {
      throw new Error("RAG skill selection requires VectorManager.");
    }
    const queryEmbedding = await params.vectorManager.getQueryEmbedding(params.userInput);
    return params.vectorManager.searchSkillsScored(queryEmbedding, allSkills, limit);
  }

  private async selectViaLlm(
    params: SkillSelectionParams,
    allSkills: Skill[],
    limit: number,
  ): Promise<Scored<Skill>[]> {
    const catalog = formatCatalogLines(allSkills);

    const systemPrompt = [
      "Select which skills are needed to fulfill the user's request.",
      `Pick up to ${limit} skills from the catalog.`,
      "Use exact names from the catalog. Prefer fewer, highly relevant items.",
      'Respond with ONLY valid JSON matching this type: {"skill_names":["..."]}',
      "Return an empty array if no skills are needed.",
    ].join(" ");

    const prompt = [`User request:\n${params.userInput}`, `\nSkills:\n${catalog}`].join("\n");
    const raw = await params.llm.complete(prompt, systemPrompt);

    const parsed = JSON.parse(raw.trim()) as { skill_names?: unknown };
    const skillNames = normalizeNameList(parsed.skill_names);
    const skillByName = new Map(allSkills.map((skill) => [skill.name, skill]));

    return resolveNamesToScored(skillNames, skillByName, limit, "skill selection");
  }
}
