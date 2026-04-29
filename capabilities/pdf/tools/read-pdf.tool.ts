import { readFile } from "node:fs/promises";
import pdf from "pdf-parse";
import type { Tool, ToolContext } from "../../../interfaces/types.js";
import { logger } from "../../../services/logger.js";

export class ReadPdfTool implements Tool {
  name = "read_pdf";
  description = "Extract text content from a PDF file.";

  async run(input: Record<string, unknown>, _context: ToolContext): Promise<unknown> {
    const { path } = input;

    if (typeof path !== "string" || !path) {
      throw new Error("read_pdf requires a 'path' string.");
    }

    try {
      const dataBuffer = await readFile(path);
      const data = await pdf(dataBuffer);
      
      return {
        text: data.text,
        info: data.info,
        numpages: data.numpages,
        success: true
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to read PDF: ${message}`);
      throw new Error(`Failed to read PDF: ${message}`);
    }
  }
}
