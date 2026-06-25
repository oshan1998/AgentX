import type { ToolRegistry } from "../../../../common/interfaces/registry.js";
import type { LlmAdapter, Tool } from "../../../../common/interfaces/types.js";
import { logger } from "../../../../common/services/logger.js";
import type { Scored, VectorManager } from "../../../../managers/vector-manager.js";
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
  capabilityRetrievalMethod?: CapabilityRetrievalMethod;
}

export class ToolSelectionService {
  async select(params: ToolSelectionParams): Promise<Scored<Tool>[]> {
    const allTools = params.toolRegistry.list();
    const limit = DEFAULT_RETRIEVED_TOOL_LIMIT;
    const method = resolveCapabilityRetrievalMethod(params.capabilityRetrievalMethod);

    if (method === "rag") {
      return this.selectViaRag(params, allTools, limit);
    }

    try {
      return await this.selectViaLlm(params, allTools, limit);
    } catch (err) {
      if (!params.vectorManager) throw err;
      logger.warn("LLM tool selection failed; falling back to RAG.", { error: err });
      return this.selectViaRag(params, allTools, limit);
    }
  }

  private async selectViaRag(
    params: ToolSelectionParams,
    allTools: Tool[],
    limit: number,
  ): Promise<Scored<Tool>[]> {
    if (!params.vectorManager) {
      throw new Error("RAG tool selection requires VectorManager.");
    }
    const queryEmbedding = await params.vectorManager.getEmbedding(params.userInput);
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
