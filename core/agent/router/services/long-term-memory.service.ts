import type { LongTermMemoryEntry } from "../../../../common/interfaces/types.js";
import { logger } from "../../../../common/services/logger.js";
import type { MemoryManager } from "../../../../managers/memory-manager.js";

export const DEFAULT_RETRIEVED_MEMORY_LIMIT = 5;

export interface LongTermMemoryParams {
  userInput: string;
  memoryManager: MemoryManager;
  limit?: number;
}

export class LongTermMemoryService {
  async retrieve(params: LongTermMemoryParams): Promise<LongTermMemoryEntry[]> {
    const { userInput, memoryManager, limit = DEFAULT_RETRIEVED_MEMORY_LIMIT } = params;
    const query = userInput.trim();

    if (!query) {
      return [];
    }

    const results = await memoryManager.searchLongTermMemory(query, limit);

    logger.debug("[long-term-memory] RAG retrieval completed", {
      queryLength: query.length,
      limit,
      hitCount: results.length,
    });

    return results;
  }
}
