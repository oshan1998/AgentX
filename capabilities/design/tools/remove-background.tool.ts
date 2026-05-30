import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { removeBackground } from "@imgly/background-removal-node";
import type { Tool, ToolContext } from "../../../common/interfaces/types.js";
import { logger } from "../../../common/services/logger.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../../common/services/zod-tool-schema.js";
import {
  DEFAULT_WORKSPACE_BASE,
  resolveWorkspacePath,
} from "../../../common/services/workspace-path.js";

export const removeBackgroundInputSchema = z.object({
  sourcePath: z
    .string()
    .min(1)
    .describe("Workspace-relative path to the source image."),
  outputPath: z
    .string()
    .optional()
    .describe("Optional Workspace-relative output path for the transparent background image (e.g. assets/transparent.png)."),
  maskOutputPath: z
    .string()
    .optional()
    .describe("Optional Workspace-relative output path for the B/W mask image (e.g. assets/mask.png)."),
}).refine(data => data.outputPath || data.maskOutputPath, {
  message: "Either outputPath or maskOutputPath must be provided",
});

export class RemoveBackgroundTool implements Tool {
  name = "remove_background";
  description =
    "Remove the background from an image, outputting a transparent PNG, a black-and-white mask, or both. The mask can be used directly with edit_image background_swap.";
  inputSchema = zodSchemaToJsonInputSchema(removeBackgroundInputSchema);

  async run(input: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const parsed = parseToolInput(this.name, removeBackgroundInputSchema, input);

    try {
      logger.info(`Removing background for image ${parsed.sourcePath}`);

      const absSource = resolveWorkspacePath(DEFAULT_WORKSPACE_BASE, context.sessionId, parsed.sourcePath);
      
      const sourceBuffer = await readFile(absSource);
      
      const blob = new Blob([sourceBuffer]);
      
      const resultBlob = await removeBackground(blob);
      const arrayBuffer = await resultBlob.arrayBuffer();
      const transparentBuffer = Buffer.from(arrayBuffer);

      let savedTransparent = false;
      let savedMask = false;

      if (parsed.outputPath) {
        const absOutput = resolveWorkspacePath(DEFAULT_WORKSPACE_BASE, context.sessionId, parsed.outputPath);
        await mkdir(path.dirname(absOutput), { recursive: true });
        await writeFile(absOutput, transparentBuffer);
        savedTransparent = true;
      }

      if (parsed.maskOutputPath) {
        const absMaskOutput = resolveWorkspacePath(DEFAULT_WORKSPACE_BASE, context.sessionId, parsed.maskOutputPath);
        await mkdir(path.dirname(absMaskOutput), { recursive: true });
        
        const maskBuffer = await sharp(transparentBuffer)
          .extractChannel('alpha')
          .toColorspace('b-w')
          .png()
          .toBuffer();
          
        await writeFile(absMaskOutput, maskBuffer);
        savedMask = true;
      }

      return {
        success: true,
        sourcePath: parsed.sourcePath,
        outputPath: parsed.outputPath ?? null,
        maskOutputPath: parsed.maskOutputPath ?? null,
        savedTransparent,
        savedMask,
        message: "Background removed successfully.",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`remove_background failed: ${message}`);
      throw new Error(`remove_background failed: ${message}`);
    }
  }
}
