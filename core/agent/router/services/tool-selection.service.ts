import type { ToolRegistry } from "../../../../common/interfaces/registry.js";
import type { LlmAdapter, Tool } from "../../../../common/interfaces/types.js";
import type { Scored, VectorManager } from "../../../../managers/vector-manager.js";
import type { CapabilityRetrievalMethod } from "../../capability-retriever.js";

export interface ToolSelectionParams {
  userInput: string;
  llm: LlmAdapter;
  toolRegistry: ToolRegistry;
  vectorManager?: VectorManager;
  capabilityRetrievalMethod?: CapabilityRetrievalMethod;
}

export class ToolSelectionService {
  async select(params: ToolSelectionParams): Promise<Scored<Tool>[]> {
    void params;
    throw new Error("ToolSelectionService.select is not implemented");
  }
}
