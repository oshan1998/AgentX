import { MemoryManager } from "../../../managers/memory-manager.js";
import type { Tool, ToolContext } from "../../../common/interfaces/types.js";

export class SearchMemoryTool implements Tool {
  name = "search_memory";
  description = "Search long-term memory entries by text.";
  inputSchema = {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Free-text query to match memory entries.",
      },
    },
    required: ["query"],
  } as const;

  constructor(private readonly memoryManager: MemoryManager) {}

  async run(input: Record<string, unknown>, _context: ToolContext): Promise<unknown> {
    const query = input.query;
    if (typeof query !== "string" || query.length === 0) {
      throw new Error("search_memory requires { query: string }.");
    }
    return this.memoryManager.searchLongTermMemory(query);
  }
}
