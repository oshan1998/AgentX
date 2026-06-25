import type { ToolRegistry } from "../../../../common/interfaces/registry.js";
import type { LlmAdapter, Tool } from "../../../../common/interfaces/types.js";
import { logger } from "../../../../common/services/logger.js";
import type { Scored, VectorManager } from "../../../../managers/vector-manager.js";
import type { VertexRagManager } from "../../../../managers/vertex-rag-manager.js";
import {
  DEFAULT_RETRIEVED_TOOL_LIMIT,
  isAlwaysOnToolName,
  resolveCapabilityRetrievalMethod,
  type CapabilityRetrievalMethod,
} from "../../capability-retriever.js";
import {
  formatCatalogLines,
  normalizeNameList,
  resolveNamesToScored,
} from "./catalog-selection.utils.js";

export interface ToolSelectionParams {
  userInput: string;
  llm: LlmAdapter;
  toolRegistry: ToolRegistry;
  vectorManager?: VectorManager;
  vertexRagManager?: VertexRagManager;
  capabilityRetrievalMethod?: CapabilityRetrievalMethod;
}

/**
 * Score assigned to a tool that is explicitly named in the user's input.
 * Set above the classify-complexity threshold (0.5) so mentioned tools always
 * trigger the complex route regardless of RAG/LLM selection scores.
 */
const MENTION_BOOST_SCORE = 0.75;

/**
 * After RAG or LLM selection, scan the user input for tools whose name-words
 * all appear in the query. This catches capability-mention queries like
 * "i think you have web search ability" where the LLM returns no tools because
 * no action is strictly needed, but the tool is clearly relevant.
 */
function applyMentionBoost(
  scored: Scored<Tool>[],
  allTools: Tool[],
  userInput: string,
): Scored<Tool>[] {
  const lowerInput = userInput.toLowerCase();
  const byName = new Map(scored.map((s) => [s.item.name, s]));
  const result = [...scored];

  for (const tool of allTools) {
    if (isAlwaysOnToolName(tool.name)) continue;

    // Split on underscores, skip single-char fragments to avoid noise
    const words = tool.name.toLowerCase().split("_").filter((w) => w.length > 1);
    if (words.length === 0) continue;
    if (!words.every((w) => lowerInput.includes(w))) continue;

    const existing = byName.get(tool.name);
    if (!existing) {
      const entry = { item: tool, score: MENTION_BOOST_SCORE };
      result.push(entry);
      byName.set(tool.name, entry);
      logger.debug("[tool-selection] mention boost: added tool", { tool: tool.name });
    } else if (existing.score < MENTION_BOOST_SCORE) {
      const idx = result.findIndex((s) => s.item.name === tool.name);
      if (idx !== -1) {
        result[idx] = { item: existing.item, score: MENTION_BOOST_SCORE };
        logger.debug("[tool-selection] mention boost: raised score", { tool: tool.name });
      }
    }
  }

  return result;
}

export class ToolSelectionService {
  async select(params: ToolSelectionParams): Promise<Scored<Tool>[]> {
    const allTools = params.toolRegistry.list();
    const limit = DEFAULT_RETRIEVED_TOOL_LIMIT;
    const method = resolveCapabilityRetrievalMethod(params.capabilityRetrievalMethod);

    let scored: Scored<Tool>[];

    if (method === "vertex_rag") {
      if (!params.vertexRagManager) {
        logger.warn("vertex_rag tool selection requested but no VertexRagManager — falling back to LLM.");
        scored = await this.selectViaLlm(params, allTools, limit);
      } else {
        scored = await params.vertexRagManager.queryTools(params.userInput, allTools, limit);
      }
    } else if (method === "rag") {
      if (!params.vectorManager) {
        logger.warn("RAG tool selection requested but no VectorManager — falling back to LLM.");
        scored = await this.selectViaLlm(params, allTools, limit);
      } else {
        scored = await this.selectViaRag(params, allTools, limit);
      }
    } else {
      try {
        scored = await this.selectViaLlm(params, allTools, limit);
      } catch (err) {
        if (!params.vectorManager) throw err;
        logger.warn("LLM tool selection failed; falling back to RAG.", { error: err });
        scored = await this.selectViaRag(params, allTools, limit);
      }
    }

    return applyMentionBoost(scored, allTools, params.userInput);
  }

  private async selectViaRag(
    params: ToolSelectionParams,
    allTools: Tool[],
    limit: number,
  ): Promise<Scored<Tool>[]> {
    if (!params.vectorManager) {
      throw new Error("RAG tool selection requires VectorManager.");
    }
    const queryEmbedding = await params.vectorManager.getQueryEmbedding(params.userInput);
    return params.vectorManager.searchToolsScored(queryEmbedding, allTools, limit);
  }

  private async selectViaLlm(
    params: ToolSelectionParams,
    allTools: Tool[],
    limit: number,
  ): Promise<Scored<Tool>[]> {
    const selectableTools = allTools.filter((tool) => !isAlwaysOnToolName(tool.name));
    const catalog = formatCatalogLines(selectableTools);

    const systemPrompt = [
      "Select which tools are needed to fulfill the user's request.",
      `Pick up to ${limit} tools from the catalog.`,
      "Use exact names from the catalog. Prefer fewer, highly relevant items.",
      'Respond with ONLY valid JSON matching this type: {"tool_names":["..."]}',
      "Return an empty array if no tools are needed.",
      "Do not select meta/planning tools (list_capabilities, orchestrate_task_graph, etc.) — they are always available.",
    ].join(" ");

    const prompt = [`User request:\n${params.userInput}`, `\nTools:\n${catalog}`].join("\n");
    const raw = await params.llm.complete(prompt, systemPrompt);

    const parsed = JSON.parse(raw.trim()) as { tool_names?: unknown };
    const toolNames = normalizeNameList(parsed.tool_names);
    const toolByName = new Map(allTools.map((tool) => [tool.name, tool]));
    const selected = resolveNamesToScored(toolNames, toolByName, limit, "tool selection");

    const alwaysOnNames = new Set(
      allTools.filter((tool) => isAlwaysOnToolName(tool.name)).map((tool) => tool.name),
    );
    const alwaysOn = allTools
      .filter((tool) => isAlwaysOnToolName(tool.name))
      .map((item) => ({ item, score: 1 }));

    return [...alwaysOn, ...selected.filter((entry) => !alwaysOnNames.has(entry.item.name))];
  }
}
