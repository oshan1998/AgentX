import puppeteer from "puppeteer";
import type { Tool, ToolContext } from "../../../common/interfaces/types.js";
import { logger } from "../../../services/logger.js";

export class GenerateDesignedPdfTool implements Tool {
  name = "generate_designed_pdf";
  description = "Generate a PDF file from HTML content, allowing for complex designs, CSS styling, and layouts.";

  async run(input: Record<string, unknown>, _context: ToolContext): Promise<unknown> {
    const { outputPath, html } = input;
    const format = input.format || "A4";
    const landscape = input.landscape === "true" || input.landscape === true;

    if (typeof outputPath !== "string" || !outputPath) {
      throw new Error("generate_designed_pdf requires an 'outputPath' string.");
    }

    if (typeof html !== "string" || !html) {
      throw new Error("generate_designed_pdf requires an 'html' string.");
    }

    try {
      logger.info(`Starting designed PDF generation for: ${outputPath}`);
      
      // On Mac, we try to use the system Chrome if puppeteer didn't download its own
      const executablePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
      
      const browser = await puppeteer.launch({
        headless: true,
        executablePath: executablePath,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
      
      const page = await browser.newPage();
      
      // Set the content of the page
      await page.setContent(html, { 
        waitUntil: "networkidle0",
        timeout: 30000 
      });
      
      // Generate the PDF
      await page.pdf({
        path: outputPath,
        format: format as any,
        landscape: landscape as boolean,
        printBackground: true,
        margin: {
          top: "0px",
          right: "0px",
          bottom: "0px",
          left: "0px",
        },
      });

      await browser.close();
      
      logger.info(`Designed PDF successfully generated at: ${outputPath}`);
      return { 
        success: true, 
        outputPath,
        message: "PDF generated successfully with custom design." 
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to generate designed PDF: ${message}`);
      throw new Error(`Failed to generate designed PDF: ${message}`);
    }
  }
}
