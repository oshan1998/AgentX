import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { Tool, ToolContext } from "../../../common/interfaces/types.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../../common/services/zod-tool-schema.js";

export const readFileInputSchema = z.object({
  path: z.string().min(1).describe("File path under workspace/"),
});

export type ReadFileInput = z.infer<typeof readFileInputSchema>;

export class ReadFileTool implements Tool {
  name = "read_file";
  description = "Read text content from a file path.";
  inputSchema = zodSchemaToJsonInputSchema(readFileInputSchema);

  async run(input: Record<string, unknown>, _context: ToolContext): Promise<unknown> {
    const { path: filePath } = parseToolInput(this.name, readFileInputSchema, input);
    return readFile(filePath, "utf-8");
  }
}
