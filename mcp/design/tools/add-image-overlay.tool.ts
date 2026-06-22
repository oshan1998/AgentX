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

const textOverlaySchema = z.object({
  text: z.string().min(1),
  left: z.number().int().min(0),
  top: z.number().int().min(0),
  fontSize: z.number().int().positive().optional(),
  color: z.string().optional().describe('Fill color, e.g. "#ffffff". Default white.'),
  fontFamily: z.string().optional().describe('CSS font-family. Default "Arial, sans-serif".'),
  fontWeight: z
    .union([z.number(), z.enum(["normal", "bold"])])
    .optional()
    .describe("Font weight. Default bold for headlines."),
  maxWidth: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Wrap text to this width in pixels."),
  opacity: z.number().min(0).max(1).optional(),
});

const imageOverlaySchema = z.object({
  overlayPath: z.string().min(1).describe("Workspace-relative overlay image path."),
  left: z.number().int().min(0),
  top: z.number().int().min(0),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  opacity: z.number().min(0).max(1).optional(),
});

export const addImageOverlayInputSchema = z.object({
  sourcePath: z.string().min(1).describe("Workspace-relative base image path."),
  outputPath: z.string().min(1).describe("Workspace-relative output image path."),
  textOverlays: z.array(textOverlaySchema).optional(),
  imageOverlays: z.array(imageOverlaySchema).optional(),
  format: z.enum(["png", "jpeg", "webp"]).optional(),
  quality: z.number().int().min(1).max(100).optional(),
});

export type AddImageOverlayInput = z.infer<typeof addImageOverlayInputSchema>;

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [text];
}

async function applyOpacity(buffer: Buffer, opacity: number): Promise<Buffer> {
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

export class AddImageOverlayTool implements Tool {
  name = "add_image_overlay";
  description =
    "Stamp text labels and/or image overlays (logos, badges) onto a base workspace image and save the result.";
  inputSchema = zodSchemaToJsonInputSchema(addImageOverlayInputSchema);

  async run(input: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const parsed = parseToolInput(this.name, addImageOverlayInputSchema, input);

    if (
      (!parsed.textOverlays || parsed.textOverlays.length === 0) &&
      (!parsed.imageOverlays || parsed.imageOverlays.length === 0)
    ) {
      throw new Error("add_image_overlay: provide at least one textOverlays or imageOverlays entry.");
    }

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
      logger.info(`Overlay on ${parsed.sourcePath} → ${parsed.outputPath}`);
      await mkdir(path.dirname(absOutput), { recursive: true });

      const baseMeta = await sharp(absSource).metadata();
      const canvasW = baseMeta.width ?? 1080;
      const canvasH = baseMeta.height ?? 1080;

      const composites: sharp.OverlayOptions[] = [];

      for (const overlay of parsed.imageOverlays ?? []) {
        const absOverlay = resolveWorkspacePath(
          DEFAULT_WORKSPACE_BASE,
          context.sessionId,
          overlay.overlayPath,
        );
        let img = sharp(absOverlay);
        if (overlay.width || overlay.height) {
          img = img.resize(overlay.width, overlay.height, { fit: "fill" });
        }
        let buffer = await img.toBuffer();
        if (overlay.opacity !== undefined && overlay.opacity < 1) {
          buffer = await applyOpacity(buffer, overlay.opacity);
        }
        composites.push({ input: buffer, left: overlay.left, top: overlay.top });
      }

      for (const text of parsed.textOverlays ?? []) {
        const fontSize = text.fontSize ?? 48;
        const color = text.color ?? "#ffffff";
        const fontFamily = text.fontFamily ?? "Arial, sans-serif";
        const fontWeight = text.fontWeight ?? "bold";
        const maxWidth = text.maxWidth ?? Math.max(100, canvasW - text.left - 40);
        const approxChars = Math.max(8, Math.floor(maxWidth / (fontSize * 0.55)));
        const lines = wrapText(text.text, approxChars);
        const lineHeight = Math.round(fontSize * 1.25);
        const blockHeight = lines.length * lineHeight + fontSize;
        const tspans = lines
          .map(
            (line, i) =>
              `<tspan x="0" dy="${i === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`,
          )
          .join("");

        const svg = `<svg width="${maxWidth}" height="${blockHeight}" xmlns="http://www.w3.org/2000/svg">
  <text x="0" y="${fontSize}" font-family="${escapeXml(fontFamily)}" font-size="${fontSize}" font-weight="${fontWeight}" fill="${escapeXml(color)}">${tspans}</text>
</svg>`;

        let buffer = await sharp(Buffer.from(svg)).png().toBuffer();
        if (text.opacity !== undefined && text.opacity < 1) {
          buffer = await applyOpacity(buffer, text.opacity);
        }
        composites.push({ input: buffer, left: text.left, top: text.top });
      }

      let pipeline = sharp(absSource).composite(composites);

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
        textOverlayCount: parsed.textOverlays?.length ?? 0,
        imageOverlayCount: parsed.imageOverlays?.length ?? 0,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`add_image_overlay failed: ${message}`);
      throw new Error(`add_image_overlay failed: ${message}`);
    }
  }
}
