import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import type { Tool, ToolContext } from "../../../common/interfaces/types.js";
import { logger } from "../../_shared/logger.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../_shared/zod-tool-schema.js";
import {
  DEFAULT_WORKSPACE_BASE,
  resolveWorkspacePath,
} from "../../_shared/workspace-path.js";

const blendModeSchema = z.enum([
  "over",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
]);

const layerSchema = z.object({
  path: z.string().min(1).describe("Workspace-relative image path for this layer."),
  left: z.number().int().describe("X offset from canvas left (pixels)."),
  top: z.number().int().describe("Y offset from canvas top (pixels)."),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  opacity: z.number().min(0).max(1).optional(),
  rotate: z.number().optional().describe("Rotation in degrees before placement."),
  blend: blendModeSchema.optional().describe('Composite blend mode. Default "over".'),
});

export const composeLayersInputSchema = z.object({
  outputPath: z.string().min(1).describe("Workspace-relative output PNG path."),
  width: z.number().int().positive().describe("Canvas width in pixels."),
  height: z.number().int().positive().describe("Canvas height in pixels."),
  background: z
    .string()
    .optional()
    .describe('Canvas background color (default "#ffffff").'),
  layers: z
    .array(layerSchema)
    .min(1)
    .describe("Layers composited in order (bottom to top)."),
});

export type ComposeLayersInput = z.infer<typeof composeLayersInputSchema>;

async function applyLayerOpacity(buffer: Buffer, opacity: number): Promise<Buffer> {
  if (opacity >= 1) return buffer;
  return sharp(buffer)
    .ensureAlpha()
    .composite([
      {
        input: Buffer.from([0, 0, 0, Math.round(opacity * 255)]),
        raw: { width: 1, height: 1, channels: 4 },
        tile: true,
        blend: "dest-in",
      },
    ])
    .png()
    .toBuffer();
}

export class ComposeLayersTool implements Tool {
  name = "compose_layers";
  description =
    "Stack multiple workspace images onto a canvas and export a single PNG. Supports per-layer position, size, opacity, rotation, and blend mode.";
  inputSchema = zodSchemaToJsonInputSchema(composeLayersInputSchema);

  async run(input: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const parsed = parseToolInput(this.name, composeLayersInputSchema, input);
    const absOutput = resolveWorkspacePath(
      DEFAULT_WORKSPACE_BASE,
      context.sessionId,
      parsed.outputPath,
    );
    const background = parsed.background ?? "#ffffff";

    try {
      logger.info(`Composing ${parsed.layers.length} layer(s) → ${parsed.outputPath}`);
      await mkdir(path.dirname(absOutput), { recursive: true });

      const composites: sharp.OverlayOptions[] = [];
      for (const layer of parsed.layers) {
        const absLayer = resolveWorkspacePath(
          DEFAULT_WORKSPACE_BASE,
          context.sessionId,
          layer.path,
        );
        let img = sharp(absLayer);
        if (layer.rotate !== undefined) {
          img = img.rotate(layer.rotate);
        }
        if (layer.width || layer.height) {
          img = img.resize(layer.width, layer.height, { fit: "fill" });
        }
        let buffer = await img.toBuffer();
        if (layer.opacity !== undefined && layer.opacity < 1) {
          buffer = await applyLayerOpacity(buffer, layer.opacity);
        }
        composites.push({
          input: buffer,
          left: layer.left,
          top: layer.top,
          blend: layer.blend ?? "over",
        });
      }

      await sharp({
        create: {
          width: parsed.width,
          height: parsed.height,
          channels: 4,
          background,
        },
      })
        .composite(composites)
        .png()
        .toFile(absOutput);

      return {
        success: true,
        outputPath: parsed.outputPath,
        width: parsed.width,
        height: parsed.height,
        layerCount: parsed.layers.length,
        message: "Composed image written.",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`compose_layers failed: ${message}`);
      throw new Error(`compose_layers failed: ${message}`);
    }
  }
}
