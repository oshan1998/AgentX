import { readFile } from "node:fs/promises";
import path from "node:path";
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

  async run(input: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const { path: filePath } = parseToolInput(this.name, readFileInputSchema, input);
    
    // Normalize and prefix with context.workDir to ensure strict sandbox/session isolation
    const relativePath = filePath.startsWith("workspace/") || filePath.startsWith("workspace\\")
      ? filePath.substring("workspace/".length)
      : filePath;
    const resolvedPath = path.join(context.workDir, relativePath);

    return readFile(resolvedPath, "utf-8");
  }
}
