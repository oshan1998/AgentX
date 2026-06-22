import { readdir } from "node:fs/promises";
import { z } from "zod";
import type { Tool, ToolContext } from "../../common/interfaces/types.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../common/services/zod-tool-schema.js";
import {
  DEFAULT_WORKSPACE_BASE,
  resolveWorkspacePath,
} from "../../common/services/workspace-path.js";

export const listDirectoryInputSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe(
      "Directory relative to this session workspace (e.g. tasks, workspace/tasks, or . for root).",
    ),
});

export type ListDirectoryInput = z.infer<typeof listDirectoryInputSchema>;

export class ListDirectoryTool implements Tool {
  name = "list_directory";
  description = "List files and folders in a directory within this session's workspace.";
  inputSchema = zodSchemaToJsonInputSchema(listDirectoryInputSchema);

  async run(input: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const { path: dirPath } = parseToolInput(this.name, listDirectoryInputSchema, input);
    const absPath = resolveWorkspacePath(DEFAULT_WORKSPACE_BASE, context.sessionId, dirPath);
    const entries = await readdir(absPath, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? "directory" : "file",
    }));
  }
}
