import { mkdir } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer";
import { z } from "zod";
import type { Tool, ToolContext } from "../../../common/interfaces/types.js";
import { logger } from "../../../common/services/logger.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../../common/services/zod-tool-schema.js";

export const generateDesignedPdfInputSchema = z.object({
  outputPath: z.string().min(1).describe("Where to save the PDF (under workspace/)."),
  html: z.string().min(1).describe("Full HTML document body or page to render."),
  format: z
    .string()
    .optional()
    .describe('Paper size label e.g. "A4", "Letter". Default A4.'),
  landscape: z
    .union([z.boolean(), z.literal("true")])
    .optional()
    .describe("Optional; portrait if omitted/false."),
});

export type GenerateDesignedPdfInput = z.infer<typeof generateDesignedPdfInputSchema>;

export class GenerateDesignedPdfTool implements Tool {
  name = "generate_designed_pdf";
  description =
    "Generate a PDF file from HTML content, allowing for complex designs, CSS styling, and layouts.";
  inputSchema = zodSchemaToJsonInputSchema(generateDesignedPdfInputSchema);

  async run(input: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const { outputPath, html, format: formatRaw, landscape: landscapeRaw } = parseToolInput(
      this.name,
      generateDesignedPdfInputSchema,
      input,
    );
    const format = formatRaw ?? "A4";
    const landscape = landscapeRaw === "true" || landscapeRaw === true;

    // Normalize and prefix with context.workDir to ensure strict sandbox/session isolation
    const relativePath = outputPath.startsWith("workspace/") || outputPath.startsWith("workspace\\")
      ? outputPath.substring("workspace/".length)
      : outputPath;
    const resolvedPath = path.join(context.workDir, relativePath);

    try {
      logger.info(`Starting designed PDF generation for: ${resolvedPath}`);

      const executablePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

      // Ensure directory exists
      const dir = path.dirname(resolvedPath);
      if (dir !== "." && dir.length > 0) {
        await mkdir(dir, { recursive: true });
      }

      const browser = await puppeteer.launch({
        headless: true,
        executablePath,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });

      const page = await browser.newPage();

      await page.setContent(html, {
        waitUntil: "networkidle0",
        timeout: 30000,
      });

      await page.pdf({
        path: resolvedPath,
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

      await browser.close();

      logger.info(`Designed PDF successfully generated at: ${resolvedPath}`);
      return {
        success: true,
        outputPath: resolvedPath,
        message: "PDF generated successfully with custom design.",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to generate designed PDF: ${message}`);
      throw new Error(`Failed to generate designed PDF: ${message}`);
    }
  }
}
