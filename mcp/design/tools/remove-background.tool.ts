import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import type { Tool, ToolContext } from "../../../common/interfaces/types.js";
import { removeBackground } from "../services/image-remove-background.js";
import { logger } from "../../_shared/logger.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../_shared/zod-tool-schema.js";
import {
  DEFAULT_WORKSPACE_BASE,
  resolveWorkspacePath,
} from "../../_shared/workspace-path.js";

export const removeBackgroundInputSchema = z.object({
  sourcePath: z
    .string()
    .min(1)
    .describe("Workspace-relative path to the source image."),
  outputPath: z
    .string()
    .optional()
    .describe("Optional workspace-relative output path for the transparent background image (e.g. assets/transparent.png)."),
  maskOutputPath: z
    .string()
    .optional()
    .describe(
      "Optional workspace-relative output path for a B/W background mask (white = replace) for edit_image background_swap.",
    ),
}).refine(data => data.outputPath || data.maskOutputPath, {
  message: "Either outputPath or maskOutputPath must be provided",
});

function sharpFormatToMime(format: string | undefined): string {
  switch (format) {
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "png":
      return "image/png";
    default:
      return "image/png";
  }
}

export class RemoveBackgroundTool implements Tool {
  name = "remove_background";
  description =
    "Remove the background from an image, outputting a transparent PNG, a background mask, or both. Uses Vertex AI image-segmentation (IMAGEN_SEGMENTATION_MODEL). The mask (white = background) can be used with edit_image background_swap, or omit maskPath and use background_swap with auto-detection.";
  inputSchema = zodSchemaToJsonInputSchema(removeBackgroundInputSchema);

  async run(input: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const parsed = parseToolInput(this.name, removeBackgroundInputSchema, input);

    try {
      logger.info(`Removing background for image ${parsed.sourcePath} via Vertex AI`);

      const absSource = resolveWorkspacePath(DEFAULT_WORKSPACE_BASE, context.sessionId, parsed.sourcePath);
      const sourceBuffer = await readFile(absSource);
      const sourceMeta = await sharp(absSource).metadata();

      const result = await removeBackground({
        sourceImage: sourceBuffer,
        sourceMimeType: sharpFormatToMime(sourceMeta.format),
      });

      let savedTransparent = false;
      let savedMask = false;

      if (parsed.outputPath) {
        const absOutput = resolveWorkspacePath(DEFAULT_WORKSPACE_BASE, context.sessionId, parsed.outputPath);
        await mkdir(path.dirname(absOutput), { recursive: true });
        await writeFile(absOutput, result.transparentBuffer);
        savedTransparent = true;
      }

      if (parsed.maskOutputPath) {
        const absMaskOutput = resolveWorkspacePath(
          DEFAULT_WORKSPACE_BASE,
          context.sessionId,
          parsed.maskOutputPath,
        );
        await mkdir(path.dirname(absMaskOutput), { recursive: true });
        await writeFile(absMaskOutput, result.backgroundMaskBuffer);
        savedMask = true;
      }

      return {
        success: true,
        sourcePath: parsed.sourcePath,
        outputPath: parsed.outputPath ?? null,
        maskOutputPath: parsed.maskOutputPath ?? null,
        savedTransparent,
        savedMask,
        provider: result.provider,
        model: result.model,
        message: "Background removed successfully.",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`remove_background failed: ${message}`);
      throw new Error(`remove_background failed: ${message}`);
    }
  }
}
