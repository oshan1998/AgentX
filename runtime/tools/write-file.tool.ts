import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Tool, ToolContext } from "../../common/interfaces/types.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../common/services/zod-tool-schema.js";
import {
  DEFAULT_WORKSPACE_BASE,
  resolveWorkspacePath,
} from "../../common/services/workspace-path.js";

export const writeFileInputSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe("Relative path in this session workspace (e.g. tasks/notes.md, tasks/data.json)."),
  content: z.string().describe("Full file contents as UTF-8 text."),
});

export type WriteFileInput = z.infer<typeof writeFileInputSchema>;

export class WriteFileTool implements Tool {
  name = "write_file";
  description =
    "Write text content into a file in this session's workspace. Creates parent directories if needed.";
  inputSchema = zodSchemaToJsonInputSchema(writeFileInputSchema);

  async run(input: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const { path: filePath, content } = parseToolInput(this.name, writeFileInputSchema, input);
    const absPath = resolveWorkspacePath(DEFAULT_WORKSPACE_BASE, context.sessionId, filePath);
    const dir = path.dirname(absPath);
    await mkdir(dir, { recursive: true });
    await writeFile(absPath, content, "utf-8");
    return { success: true, path: filePath };
  }
}
