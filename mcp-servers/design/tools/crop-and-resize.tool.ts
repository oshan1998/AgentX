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

const fitModeSchema = z.enum(["cover", "contain", "fill", "inside", "outside"]);

export const cropAndResizeInputSchema = z.object({
  sourcePath: z.string().min(1).describe("Workspace-relative source image path."),
  outputPath: z.string().min(1).describe("Workspace-relative output image path."),
  width: z.number().int().positive().describe("Target width in pixels."),
  height: z.number().int().positive().describe("Target height in pixels."),
  fit: fitModeSchema
    .optional()
    .describe('Resize strategy. Default "cover" (crop to fill).'),
  background: z
    .string()
    .optional()
    .describe('Background when fit is "contain" (e.g. #ffffff).'),
  format: z
    .enum(["png", "jpeg", "webp"])
    .optional()
    .describe("Output format. Inferred from outputPath extension when omitted."),
  quality: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("JPEG/WebP quality (1–100). Default 90."),
});

export type CropAndResizeInput = z.infer<typeof cropAndResizeInputSchema>;

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

export class CropAndResizeTool implements Tool {
  name = "crop_and_resize";
  description =
    "Resize a workspace image to exact pixel dimensions with configurable fit strategy (cover, contain, fill). Outputs PNG, JPEG, or WebP.";
  inputSchema = zodSchemaToJsonInputSchema(cropAndResizeInputSchema);

  async run(input: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const parsed = parseToolInput(this.name, cropAndResizeInputSchema, input);
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
    const fit = parsed.fit ?? "cover";
    const format = inferFormat(parsed.outputPath, parsed.format);
    const quality = parsed.quality ?? 90;

    try {
      logger.info(`Crop/resize ${parsed.sourcePath} → ${parsed.outputPath}`);
      await mkdir(path.dirname(absOutput), { recursive: true });

      let pipeline = sharp(absSource).resize(parsed.width, parsed.height, {
        fit,
        background: parsed.background ?? "#ffffff",
      });

      if (format === "jpeg") {
        await pipeline.jpeg({ quality }).toFile(absOutput);
      } else if (format === "webp") {
        await pipeline.webp({ quality }).toFile(absOutput);
      } else {
        await pipeline.png().toFile(absOutput);
      }

      return {
        success: true,
        sourcePath: parsed.sourcePath,
        outputPath: parsed.outputPath,
        width: parsed.width,
        height: parsed.height,
        fit,
        format,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`crop_and_resize failed: ${message}`);
      throw new Error(`crop_and_resize failed: ${message}`);
    }
  }
}
