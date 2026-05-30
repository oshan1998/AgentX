import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import type { ImageEditMode, Tool, ToolContext } from "../../../common/interfaces/types.js";
import { editImage } from "../../../common/services/image-edit.js";
import { logger } from "../../../common/services/logger.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../../common/services/zod-tool-schema.js";
import {
  DEFAULT_WORKSPACE_BASE,
  resolveWorkspacePath,
} from "../../../common/services/workspace-path.js";

const editModeSchema = z.enum([
  "default",
  "inpaint_insert",
  "inpaint_remove",
  "outpaint",
  "background_swap",
  "style",
  "upscale",
]);

export const editImageInputSchema = z.object({
  sourcePath: z
    .string()
    .min(1)
    .describe("Workspace-relative path to the source image to edit or upscale."),
  outputPath: z
    .string()
    .min(1)
    .describe("Workspace-relative output path (e.g. assets/enhanced.png)."),
  prompt: z
    .string()
    .optional()
    .describe(
      "Text instruction describing the edit (e.g. \"Enhance lighting and sharpness\", \"Remove the person on the left\"). Required except for mode upscale.",
    ),
  mode: editModeSchema
    .optional()
    .describe(
      "Edit strategy: default (general enhance/edit), inpaint_insert, inpaint_remove, outpaint, background_swap, style, upscale.",
    ),
  maskPath: z
    .string()
    .optional()
    .describe(
      "Workspace-relative mask image for inpaint/outpaint modes. White pixels = region to edit; black = preserve.",
    ),
  aspectRatio: z
    .enum(["1:1", "3:4", "4:3", "9:16", "16:9"])
    .optional()
    .describe("Optional output aspect ratio for edit modes (not upscale)."),
  negativePrompt: z
    .string()
    .optional()
    .describe("Optional negative prompt to discourage unwanted elements."),
  upscaleFactor: z
    .enum(["x2", "x4"])
    .optional()
    .describe("Upscale multiplier when mode is upscale. Default x2."),
  personGeneration: z
    .enum(["allow_all", "allow_adult", "dont_allow"])
    .optional()
    .describe(
      "Person-generation safety: allow_all (default, required when source has children), allow_adult, dont_allow.",
    ),
});

export type EditImageToolInput = z.infer<typeof editImageInputSchema>;

const MASK_REQUIRED_MODES = new Set<ImageEditMode>([
  "inpaint_insert",
  "inpaint_remove",
  "outpaint",
]);

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

function extensionForMime(mimeType: string): string {
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/webp") return ".webp";
  return ".png";
}

function ensureExtension(outputPath: string, mimeType: string): string {
  const ext = path.extname(outputPath).toLowerCase();
  if (ext.length) return outputPath;
  return `${outputPath}${extensionForMime(mimeType)}`;
}

async function loadWorkspaceImage(
  sessionId: string,
  relativePath: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const absPath = resolveWorkspacePath(DEFAULT_WORKSPACE_BASE, sessionId, relativePath);
  const buffer = await readFile(absPath);
  const meta = await sharp(absPath).metadata();
  return {
    buffer,
    mimeType: sharpFormatToMime(meta.format),
  };
}

export class EditImageTool implements Tool {
  name = "edit_image";
  description =
    "AI-edit an existing workspace image using Vertex Imagen. Supports general enhancement, inpainting (insert/remove), outpainting, background swap, style transfer, and x2/x4 upscaling.";
  inputSchema = zodSchemaToJsonInputSchema(editImageInputSchema);

  async run(input: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const parsed = parseToolInput(this.name, editImageInputSchema, input);
    const mode = (parsed.mode ?? "default") as ImageEditMode;

    if (mode !== "upscale" && !parsed.prompt?.trim()) {
      throw new Error("edit_image: prompt is required unless mode is upscale.");
    }

    if (MASK_REQUIRED_MODES.has(mode) && !parsed.maskPath) {
      throw new Error(`edit_image: maskPath is required when mode is ${mode}.`);
    }

    try {
      logger.info(`Editing image ${parsed.sourcePath} → ${parsed.outputPath} (mode=${mode})`);

      const source = await loadWorkspaceImage(context.sessionId, parsed.sourcePath);
      let maskImage: Buffer | undefined;
      let maskMimeType: string | undefined;

      if (parsed.maskPath) {
        const mask = await loadWorkspaceImage(context.sessionId, parsed.maskPath);
        maskImage = mask.buffer;
        maskMimeType = mask.mimeType;
      }

      const result = await editImage({
        prompt: parsed.prompt,
        mode,
        sourceImage: source.buffer,
        sourceMimeType: source.mimeType,
        maskImage,
        maskMimeType,
        aspectRatio: parsed.aspectRatio,
        negativePrompt: parsed.negativePrompt,
        upscaleFactor: parsed.upscaleFactor,
        personGeneration: parsed.personGeneration,
      });

      const outputPath = ensureExtension(parsed.outputPath, result.mimeType);
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
        sourcePath: parsed.sourcePath,
        outputPath,
        mode,
        prompt: parsed.prompt ?? null,
        maskPath: parsed.maskPath ?? null,
        width: meta.width ?? null,
        height: meta.height ?? null,
        sizeBytes: result.buffer.length,
        provider: result.provider,
        model: result.model,
        message: "Image edited and saved to workspace.",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`edit_image failed: ${message}`);
      throw new Error(`edit_image failed: ${message}`);
    }
  }
}
