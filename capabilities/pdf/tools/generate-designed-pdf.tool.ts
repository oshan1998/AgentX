import { mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Tool, ToolContext } from "../../../common/interfaces/types.js";
import {
  embedWorkspaceImagesInHtml,
  resolveWorkspaceAssetsInHtml,
} from "../../../common/services/html-workspace-assets.js";
import { withBrowserPage } from "../../../common/services/puppeteer-browser.js";
import { logger } from "../../../common/services/logger.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../../common/services/zod-tool-schema.js";
import {
  DEFAULT_WORKSPACE_BASE,
  resolveWorkspacePath,
} from "../../../common/services/workspace-path.js";

export const generateDesignedPdfInputSchema = z.object({
  outputPath: z
    .string()
    .min(1)
    .describe("Relative output path in this session workspace (e.g. reports/summary.pdf)."),
  html: z.string().min(1).describe("Full HTML document body or page to render."),
  format: z
    .string()
    .optional()
    .describe('Paper size label e.g. "A4", "Letter". Default A4.'),
  landscape: z
    .union([z.boolean(), z.literal("true")])
    .optional()
    .describe("Optional; portrait if omitted/false."),
  resolveWorkspaceAssets: z
    .boolean()
    .optional()
    .describe(
      "When true, rewrite workspace-relative img/src and css url() paths to file://. Default false; prefer embedWorkspaceAssets.",
    ),
  embedWorkspaceAssets: z
    .boolean()
    .optional()
    .describe(
      "When true, inline local workspace images as data: URIs so they render via setContent(). Default true.",
    ),
});

export type GenerateDesignedPdfInput = z.infer<typeof generateDesignedPdfInputSchema>;

export class GenerateDesignedPdfTool implements Tool {
  name = "generate_designed_pdf";
  description =
    "Generate a PDF file from HTML content, allowing for complex designs, CSS styling, and layouts.";
  inputSchema = zodSchemaToJsonInputSchema(generateDesignedPdfInputSchema);

  async run(input: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const parsed = parseToolInput(this.name, generateDesignedPdfInputSchema, input);
    const absOutputPath = resolveWorkspacePath(
      DEFAULT_WORKSPACE_BASE,
      context.sessionId,
      parsed.outputPath,
    );
    const format = parsed.format ?? "A4";
    const landscape = parsed.landscape === "true" || parsed.landscape === true;
    const embedWorkspaceAssets = parsed.embedWorkspaceAssets ?? true;
    const resolveWorkspaceAssets = parsed.resolveWorkspaceAssets ?? false;

    try {
      logger.info(`Starting designed PDF generation for: ${parsed.outputPath}`);

      await mkdir(path.dirname(absOutputPath), { recursive: true });

      let html = parsed.html;
      if (embedWorkspaceAssets) {
        html = await embedWorkspaceImagesInHtml(
          html,
          context.sessionId,
          DEFAULT_WORKSPACE_BASE,
        );
      } else if (resolveWorkspaceAssets) {
        html = resolveWorkspaceAssetsInHtml(
          html,
          context.sessionId,
          DEFAULT_WORKSPACE_BASE,
        );
      }

      await withBrowserPage(async (page) => {
        await page.setContent(html, {
          waitUntil: "networkidle0",
          timeout: 30000,
        });

        await page.pdf({
          path: absOutputPath,
          // Puppeteer PaperFormat is a fixed union; model-supplied labels are passed through like before.
          format: format as "A4" | "Letter",
          landscape,
          printBackground: true,
          margin: {
            top: "0px",
            right: "0px",
            bottom: "0px",
            left: "0px",
          },
        });
      });

      logger.info(`Designed PDF successfully generated at: ${parsed.outputPath}`);
      return {
        success: true,
        outputPath: parsed.outputPath,
        message: "PDF generated successfully with custom design.",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to generate designed PDF: ${message}`);
      throw new Error(`Failed to generate designed PDF: ${message}`);
    }
  }
}
