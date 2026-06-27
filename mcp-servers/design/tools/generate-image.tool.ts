import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Tool, ToolContext } from "../../../common/interfaces/types.js";
import { generateImage } from "../../../common/services/image-generate.js";
import { logger } from "../../../common/services/logger.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../../common/services/zod-tool-schema.js";
import {
  DEFAULT_WORKSPACE_BASE,
  resolveWorkspacePath,
} from "../../../common/services/workspace-path.js";
import sharp from "sharp";

export const generateImageInputSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .describe("Detailed text description of the image to generate."),
  outputPath: z
    .string()
    .min(1)
    .describe(
      "Workspace-relative output path (e.g. assets/hero.png). Extension optional; defaults to .png.",
    ),
  aspectRatio: z
    .enum(["1:1", "3:4", "4:3", "9:16", "16:9"])
    .optional()
    .describe("Optional aspect ratio. Default 1:1."),
});

export type GenerateImageInput = z.infer<typeof generateImageInputSchema>;

function ensurePngExtension(outputPath: string): string {
  const ext = path.extname(outputPath).toLowerCase();
  if (ext.length) return outputPath;
  return `${outputPath}.png`;
}

export class GenerateImageTool implements Tool {
  name = "generate_image";
  description =
    "Generate an image from a text prompt using AI (Google Imagen) and save the PNG to the session workspace.";
  inputSchema = zodSchemaToJsonInputSchema(generateImageInputSchema);

  async run(input: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const parsed = parseToolInput(this.name, generateImageInputSchema, input);

    try {
      logger.info(`Generating image → ${parsed.outputPath}`);
      const result = await generateImage({
        prompt: parsed.prompt,
        aspectRatio: parsed.aspectRatio,
      });

      const outputPath = ensurePngExtension(parsed.outputPath);
      const absOutput = resolveWorkspacePath(
        DEFAULT_WORKSPACE_BASE,
        context.sessionId,
        outputPath,
      );
      await mkdir(path.dirname(absOutput), { recursive: true });
      await writeFile(absOutput, result.buffer);

      const meta = await sharp(absOutput).metadata();

      return {
        success: true,
        outputPath,
        prompt: parsed.prompt,
        aspectRatio: parsed.aspectRatio ?? "1:1",
        width: meta.width ?? null,
        height: meta.height ?? null,
        sizeBytes: result.buffer.length,
        provider: result.provider,
        model: result.model,
        message: "Image generated and saved to workspace.",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`generate_image failed: ${message}`);
      throw new Error(`generate_image failed: ${message}`);
    }
  }
}
