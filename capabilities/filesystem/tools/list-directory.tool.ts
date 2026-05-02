import { readdir } from "node:fs/promises";
import { z } from "zod";
import type { Tool, ToolContext } from "../../../common/interfaces/types.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../../common/services/zod-tool-schema.js";

export const listDirectoryInputSchema = z.object({
  path: z.string().min(1).describe("Directory path to list."),
});

export type ListDirectoryInput = z.infer<typeof listDirectoryInputSchema>;

export class ListDirectoryTool implements Tool {
  name = "list_directory";
  description = "List files and folders in a directory path.";
  inputSchema = zodSchemaToJsonInputSchema(listDirectoryInputSchema);

  async run(input: Record<string, unknown>, _context: ToolContext): Promise<unknown> {
    const { path: dirPath } = parseToolInput(this.name, listDirectoryInputSchema, input);
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? "directory" : "file",
    }));
  }
}
