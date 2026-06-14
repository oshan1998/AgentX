import { stat } from "node:fs/promises";
import sharp from "sharp";
import { z } from "zod";
import type { Tool, ToolContext } from "../../../common/interfaces/types.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../../common/services/zod-tool-schema.js";
import {
  DEFAULT_WORKSPACE_BASE,
  resolveWorkspacePath,
} from "../../../common/services/workspace-path.js";

export const readImageMetadataInputSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe("Workspace-relative path to an image file (png, jpg, webp, svg, etc.)."),
});

export type ReadImageMetadataInput = z.infer<typeof readImageMetadataInputSchema>;

export class ReadImageMetadataTool implements Tool {
  name = "read_image_metadata";
  description = "Read width, height, format, and file size for an image in the session workspace.";
  inputSchema = zodSchemaToJsonInputSchema(readImageMetadataInputSchema);

  async run(input: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const { path: imagePath } = parseToolInput(this.name, readImageMetadataInputSchema, input);
    const absPath = resolveWorkspacePath(DEFAULT_WORKSPACE_BASE, context.sessionId, imagePath);
    const info = await stat(absPath);
    const meta = await sharp(absPath).metadata();

    return {
      path: imagePath,
      width: meta.width ?? null,
      height: meta.height ?? null,
      format: meta.format ?? null,
      channels: meta.channels ?? null,
      hasAlpha: meta.hasAlpha ?? null,
      sizeBytes: info.size,
    };
  }
}
