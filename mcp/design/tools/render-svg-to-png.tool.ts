import { mkdir, readFile } from "node:fs/promises";
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

export const renderSvgToPngInputSchema = z.object({
  outputPath: z
    .string()
    .min(1)
    .describe("Relative output PNG path in this session workspace."),
  svg: z.string().min(1).optional().describe("Inline SVG source. Use svgPath when omitted."),
  svgPath: z
    .string()
    .min(1)
    .optional()
    .describe("Workspace-relative path to an existing .svg file."),
  width: z.number().int().positive().optional().describe("Output width in pixels."),
  height: z.number().int().positive().optional().describe("Output height in pixels."),
  background: z
    .string()
    .optional()
    .describe("Optional background color (e.g. #ffffff or transparent)."),
});

export type RenderSvgToPngInput = z.infer<typeof renderSvgToPngInputSchema>;

export class RenderSvgToPngTool implements Tool {
  name = "render_svg_to_png";
  description = "Rasterize SVG content or a workspace SVG file to PNG.";
  inputSchema = zodSchemaToJsonInputSchema(renderSvgToPngInputSchema);

  async run(input: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const parsed = parseToolInput(this.name, renderSvgToPngInputSchema, input);
    if (!parsed.svg && !parsed.svgPath) {
      throw new Error(`${this.name}: provide svg or svgPath.`);
    }

    let svgSource = parsed.svg;
    if (!svgSource && parsed.svgPath) {
      const absSvg = resolveWorkspacePath(
        DEFAULT_WORKSPACE_BASE,
        context.sessionId,
        parsed.svgPath,
      );
      svgSource = await readFile(absSvg, "utf-8");
    }

    const absOutputPath = resolveWorkspacePath(
      DEFAULT_WORKSPACE_BASE,
      context.sessionId,
      parsed.outputPath,
    );

    try {
      logger.info(`Rendering SVG to PNG: ${parsed.outputPath}`);
      await mkdir(path.dirname(absOutputPath), { recursive: true });

      let pipeline = sharp(Buffer.from(svgSource!, "utf-8"), { density: 300 });
      if (parsed.background) {
        pipeline = pipeline.flatten({ background: parsed.background });
      }
      if (parsed.width || parsed.height) {
        pipeline = pipeline.resize(parsed.width, parsed.height, { fit: "inside" });
      }
      await pipeline.png().toFile(absOutputPath);

      return {
        success: true,
        outputPath: parsed.outputPath,
        message: "PNG generated from SVG.",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to render SVG to PNG: ${message}`);
      throw new Error(`Failed to render SVG to PNG: ${message}`);
    }
  }
}
