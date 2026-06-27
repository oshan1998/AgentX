import { z } from "zod";
import { MemoryManager } from "../managers/memory-manager.js";
import type { Tool, ToolContext } from "../common/interfaces/types.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../common/services/zod-tool-schema.js";

export const searchMemoryInputSchema = z.object({
  query: z.string().min(1).describe("Free-text query to match memory entries."),
});

export type SearchMemoryInput = z.infer<typeof searchMemoryInputSchema>;

export class SearchMemoryTool implements Tool {
  name = "search_memory";
  description = "Search long-term memory for stored facts, user preferences, and behavior rules by keyword or phrase.";
  inputSchema = zodSchemaToJsonInputSchema(searchMemoryInputSchema);

  constructor(private readonly memoryManager: MemoryManager) {}

  async run(input: Record<string, unknown>, _context: ToolContext): Promise<unknown> {
    const { query } = parseToolInput(this.name, searchMemoryInputSchema, input);
    return this.memoryManager.searchLongTermMemory(query);
  }
}
