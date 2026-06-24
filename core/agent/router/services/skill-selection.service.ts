import type { SkillRegistry } from "../../../../common/interfaces/registry.js";
import type { LlmAdapter, Skill } from "../../../../common/interfaces/types.js";
import type { Scored, VectorManager } from "../../../../managers/vector-manager.js";
import type { CapabilityRetrievalMethod } from "../../capability-retriever.js";

export interface SkillSelectionParams {
  userInput: string;
  llm: LlmAdapter;
  skillRegistry: SkillRegistry;
  vectorManager?: VectorManager;
  capabilityRetrievalMethod?: CapabilityRetrievalMethod;
}

export class SkillSelectionService {
  async select(params: SkillSelectionParams): Promise<Scored<Skill>[]> {
    void params;
    throw new Error("SkillSelectionService.select is not implemented");
  }
}
