import { mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Tool, ToolContext } from "../../../common/interfaces/types.js";
import { embedWorkspaceImagesInHtml } from "../services/html-workspace-assets.js";
import { withBrowserPage } from "../services/puppeteer-browser.js";
import { logger } from "../../_shared/logger.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../_shared/zod-tool-schema.js";
import {
  DEFAULT_WORKSPACE_BASE,
  resolveWorkspacePath,
} from "../../_shared/workspace-path.js";

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
  embedWorkspaceAssets: z
    .boolean()
    .optional()
    .describe(
      "When true (default), inline local workspace images as data: URIs so they render via setContent(). Use workspace-relative paths in HTML (e.g. assets/photo.jpg).",
    ),
});

export type RenderHtmlToPngInput = z.infer<typeof renderHtmlToPngInputSchema>;

export class RenderHtmlToPngTool implements Tool {
  name = "render_html_to_png";
  description =
    "Render a full HTML document to a PNG screenshot using headless Chrome. Ideal for pixel-perfect social graphics, banners, and layout-driven designs.";
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
    const embedWorkspaceAssets = parsed.embedWorkspaceAssets ?? true;

    try {
      logger.info(`Rendering HTML to PNG: ${parsed.outputPath}`);
      await mkdir(path.dirname(absOutputPath), { recursive: true });

      let html = parsed.html;
      const assetWarnings: string[] = [];
      if (embedWorkspaceAssets) {
        const embedded = await embedWorkspaceImagesInHtml(
          html,
          context.sessionId,
          DEFAULT_WORKSPACE_BASE,
        );
        html = embedded.html;
        assetWarnings.push(...embedded.warnings);
      } else {
        assetWarnings.push(
          "embedWorkspaceAssets is disabled; workspace-relative images may not appear in the PNG.",
        );
        logger.warn(assetWarnings[0]!);
      }

      await withBrowserPage(async (page) => {
        await page.setViewport({ width, height, deviceScaleFactor });
        await page.setContent(html, {
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
        ...(assetWarnings.length ? { warnings: assetWarnings } : {}),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to render HTML to PNG: ${message}`);
      throw new Error(`Failed to render HTML to PNG: ${message}`);
    }
  }
}
