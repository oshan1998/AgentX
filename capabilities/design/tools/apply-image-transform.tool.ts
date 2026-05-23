import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import type { Tool, ToolContext } from "../../../common/interfaces/types.js";
import { logger } from "../../../common/services/logger.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../../common/services/zod-tool-schema.js";
import {
  DEFAULT_WORKSPACE_BASE,
  resolveWorkspacePath,
} from "../../../common/services/workspace-path.js";

const extractRegionSchema = z.object({
  left: z.number().int().min(0),
  top: z.number().int().min(0),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const applyImageTransformInputSchema = z.object({
  sourcePath: z.string().min(1).describe("Workspace-relative source image path."),
  outputPath: z.string().min(1).describe("Workspace-relative output image path."),
  rotate: z
    .number()
    .optional()
    .describe("Rotation in degrees (90, 180, 270, or any angle)."),
  flip: z.enum(["horizontal", "vertical"]).optional(),
  grayscale: z.boolean().optional(),
  blur: z.number().min(0.3).max(100).optional().describe("Gaussian blur sigma."),
  sharpen: z.boolean().optional(),
  brightness: z.number().min(0).max(3).optional(),
  saturation: z.number().min(0).max(3).optional(),
  hue: z.number().min(0).max(360).optional().describe("Hue rotation in degrees."),
  extract: extractRegionSchema
    .optional()
    .describe("Crop to a rectangular region (pixels)."),
  format: z.enum(["png", "jpeg", "webp"]).optional(),
  quality: z.number().int().min(1).max(100).optional(),
});

export type ApplyImageTransformInput = z.infer<typeof applyImageTransformInputSchema>;

function inferFormat(
  outputPath: string,
  explicit?: "png" | "jpeg" | "webp",
): "png" | "jpeg" | "webp" {
  if (explicit) return explicit;
  const ext = path.extname(outputPath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "jpeg";
  if (ext === ".webp") return "webp";
  return "png";
}

export class ApplyImageTransformTool implements Tool {
  name = "apply_image_transform";
  description =
    "Edit a workspace image: rotate, flip, crop region, adjust brightness/saturation/hue, blur, sharpen, or grayscale.";
  inputSchema = zodSchemaToJsonInputSchema(applyImageTransformInputSchema);

  async run(input: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const parsed = parseToolInput(this.name, applyImageTransformInputSchema, input);
    const absSource = resolveWorkspacePath(
      DEFAULT_WORKSPACE_BASE,
      context.sessionId,
      parsed.sourcePath,
    );
    const absOutput = resolveWorkspacePath(
      DEFAULT_WORKSPACE_BASE,
      context.sessionId,
      parsed.outputPath,
    );
    const format = inferFormat(parsed.outputPath, parsed.format);
    const quality = parsed.quality ?? 90;

    try {
      logger.info(`Transform ${parsed.sourcePath} → ${parsed.outputPath}`);
      await mkdir(path.dirname(absOutput), { recursive: true });

      let pipeline = sharp(absSource);

      if (parsed.extract) {
        pipeline = pipeline.extract({
          left: parsed.extract.left,
          top: parsed.extract.top,
          width: parsed.extract.width,
          height: parsed.extract.height,
        });
      }
      if (parsed.rotate !== undefined) {
        pipeline = pipeline.rotate(parsed.rotate);
      }
      if (parsed.flip === "horizontal") {
        pipeline = pipeline.flop();
      } else if (parsed.flip === "vertical") {
        pipeline = pipeline.flip();
      }
      const modulateOptions: Record<string, number> = {};

      if (parsed.brightness !== undefined) {
        modulateOptions.brightness = parsed.brightness;
      }

      if (parsed.saturation !== undefined) {
        modulateOptions.saturation = parsed.saturation;
      }

      if (parsed.hue !== undefined) {
        modulateOptions.hue = parsed.hue;
      }

      if (Object.keys(modulateOptions).length > 0) {
        pipeline = pipeline.modulate(modulateOptions);
      }
      if (parsed.grayscale) {
        pipeline = pipeline.grayscale();
      }
      if (parsed.blur !== undefined) {
        pipeline = pipeline.blur(parsed.blur);
      }
      if (parsed.sharpen) {
        pipeline = pipeline.sharpen();
      }

      if (format === "jpeg") {
        await pipeline.jpeg({ quality }).toFile(absOutput);
      } else if (format === "webp") {
        await pipeline.webp({ quality }).toFile(absOutput);
      } else {
        await pipeline.png().toFile(absOutput);
      }

      const meta = await sharp(absOutput).metadata();
      return {
        success: true,
        sourcePath: parsed.sourcePath,
        outputPath: parsed.outputPath,
        width: meta.width ?? null,
        height: meta.height ?? null,
        format,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`apply_image_transform failed: ${message}`);
      throw new Error(`apply_image_transform failed: ${message}`);
    }
  }
}
