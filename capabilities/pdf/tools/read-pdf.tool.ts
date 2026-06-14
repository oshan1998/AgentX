import { readFile } from "node:fs/promises";
import pdf from "pdf-parse";
import { z } from "zod";
import type { Tool, ToolContext } from "../../../common/interfaces/types.js";
import { logger } from "../../../common/services/logger.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../../common/services/zod-tool-schema.js";
import {
  DEFAULT_WORKSPACE_BASE,
  resolveWorkspacePath,
} from "../../../common/services/workspace-path.js";

export const readPdfInputSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe("Relative path to PDF in this session workspace (e.g. reports/out.pdf)."),
});

export type ReadPdfInput = z.infer<typeof readPdfInputSchema>;

export class ReadPdfTool implements Tool {
  name = "read_pdf";
  description = "Extract text content from a PDF file in this session's workspace.";
  inputSchema = zodSchemaToJsonInputSchema(readPdfInputSchema);

  async run(input: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const { path: pdfPath } = parseToolInput(this.name, readPdfInputSchema, input);
    const absPath = resolveWorkspacePath(DEFAULT_WORKSPACE_BASE, context.sessionId, pdfPath);

    try {
      const dataBuffer = await readFile(absPath);
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
