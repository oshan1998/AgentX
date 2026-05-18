import { mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Tool, ToolContext } from "../../../common/interfaces/types.js";
import { withBrowserPage } from "../../../common/services/puppeteer-browser.js";
import { logger } from "../../../common/services/logger.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../../common/services/zod-tool-schema.js";
import {
  DEFAULT_WORKSPACE_BASE,
  resolveWorkspacePath,
} from "../../../common/services/workspace-path.js";

export const renderHtmlToPngInputSchema = z.object({
  outputPath: z
    .string()
    .min(1)
    .describe("Relative output path in this session workspace (e.g. designs/social.png)."),
  html: z.string().min(1).describe("Full HTML document to render."),
  width: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Viewport width in pixels. Default 1080."),
  height: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Viewport height in pixels. Default 1080."),
  fullPage: z
    .boolean()
    .optional()
    .describe("Capture full scrollable page when true; otherwise viewport only."),
  deviceScaleFactor: z
    .number()
    .positive()
    .optional()
    .describe("Pixel density multiplier (e.g. 2 for retina). Default 1."),
});

export type RenderHtmlToPngInput = z.infer<typeof renderHtmlToPngInputSchema>;

export class RenderHtmlToPngTool implements Tool {
  name = "render_html_to_png";
  description =
    "Render a complete HTML document to a PNG image using headless Chrome. Use for social graphics, banners, and layout-first designs.";
  inputSchema = zodSchemaToJsonInputSchema(renderHtmlToPngInputSchema);

  async run(input: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const parsed = parseToolInput(this.name, renderHtmlToPngInputSchema, input);
    const absOutputPath = resolveWorkspacePath(
      DEFAULT_WORKSPACE_BASE,
      context.sessionId,
      parsed.outputPath,
    );
    const width = parsed.width ?? 1080;
    const height = parsed.height ?? 1080;
    const fullPage = parsed.fullPage ?? false;
    const deviceScaleFactor = parsed.deviceScaleFactor ?? 1;

    try {
      logger.info(`Rendering HTML to PNG: ${parsed.outputPath}`);
      await mkdir(path.dirname(absOutputPath), { recursive: true });

      await withBrowserPage(async (page) => {
        await page.setViewport({ width, height, deviceScaleFactor });
        await page.setContent(parsed.html, {
          waitUntil: "networkidle0",
          timeout: 30000,
        });
        await page.screenshot({
          path: absOutputPath,
          type: "png",
          fullPage,
        });
      });

      logger.info(`PNG written: ${parsed.outputPath}`);
      return {
        success: true,
        outputPath: parsed.outputPath,
        width,
        height,
        fullPage,
        message: "PNG generated from HTML.",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to render HTML to PNG: ${message}`);
      throw new Error(`Failed to render HTML to PNG: ${message}`);
    }
  }
}
