import type { LongTermMemoryEntry } from "../../../../common/interfaces/types.js";
import type { MemoryManager } from "../../../../managers/memory-manager.js";

export interface LongTermMemoryParams {
  userInput: string;
  memoryManager: MemoryManager;
}

export class LongTermMemoryService {
  async retrieve(params: LongTermMemoryParams): Promise<LongTermMemoryEntry[]> {
    void params;
    throw new Error("LongTermMemoryService.retrieve is not implemented");
  }
}
