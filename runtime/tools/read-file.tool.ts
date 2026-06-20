import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { Tool, ToolContext } from "../../common/interfaces/types.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../common/services/zod-tool-schema.js";
import {
  DEFAULT_WORKSPACE_BASE,
  resolveWorkspacePath,
} from "../../common/services/workspace-path.js";

export const readFileInputSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe("Relative path in this session workspace for a text file (e.g. tasks/notes.md, tasks/data.json)."),
});

export type ReadFileInput = z.infer<typeof readFileInputSchema>;

export class ReadFileTool implements Tool {
  name = "read_file";
  description = "Read text content from a file path in this session's workspace.";
  inputSchema = zodSchemaToJsonInputSchema(readFileInputSchema);

  async run(input: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const { path: filePath } = parseToolInput(this.name, readFileInputSchema, input);
    const absPath = resolveWorkspacePath(DEFAULT_WORKSPACE_BASE, context.sessionId, filePath);
    return readFile(absPath, "utf-8");
  }
}
