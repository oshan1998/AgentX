import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Tool, ToolContext } from "../../../common/interfaces/types.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../_shared/zod-tool-schema.js";
import {
  DEFAULT_WORKSPACE_BASE,
  resolveWorkspacePath,
} from "../../_shared/workspace-path.js";

export const writeSvgInputSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe("Relative path in this session workspace (e.g. designs/logo.svg)."),
  content: z.string().min(1).describe("Full SVG document source."),
});

export type WriteSvgInput = z.infer<typeof writeSvgInputSchema>;

export class WriteSvgTool implements Tool {
  name = "write_svg";
  description = "Write an SVG document into this session's workspace.";
  inputSchema = zodSchemaToJsonInputSchema(writeSvgInputSchema);

  async run(input: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const { path: filePath, content } = parseToolInput(this.name, writeSvgInputSchema, input);
    const absPath = resolveWorkspacePath(DEFAULT_WORKSPACE_BASE, context.sessionId, filePath);
    await mkdir(path.dirname(absPath), { recursive: true });
    await writeFile(absPath, content, "utf-8");
    return { success: true, path: filePath };
  }
}
