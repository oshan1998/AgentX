import { readFile } from "node:fs/promises";
import pdf from "pdf-parse";
import { z } from "zod";
import type { Tool, ToolContext } from "../../../common/interfaces/types.js";
import { logger } from "../../../common/services/logger.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../../common/services/zod-tool-schema.js";

export const readPdfInputSchema = z.object({
  path: z.string().min(1).describe("Path to PDF under workspace/"),
});

export type ReadPdfInput = z.infer<typeof readPdfInputSchema>;

export class ReadPdfTool implements Tool {
  name = "read_pdf";
  description = "Extract text content from a PDF file.";
  inputSchema = zodSchemaToJsonInputSchema(readPdfInputSchema);

  async run(input: Record<string, unknown>, _context: ToolContext): Promise<unknown> {
    const { path: pdfPath } = parseToolInput(this.name, readPdfInputSchema, input);

    try {
      const dataBuffer = await readFile(pdfPath);
      const data = await pdf(dataBuffer);

      return {
        text: data.text,
        info: data.info,
        numpages: data.numpages,
        success: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to read PDF: ${message}`);
      throw new Error(`Failed to read PDF: ${message}`);
    }
  }
}
