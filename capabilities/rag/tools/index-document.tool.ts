import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Tool, ToolContext } from "../../../common/interfaces/types.js";
import { inferMimeType } from "../../../common/services/gcs.service.js";
import type { RagToolDependencies } from "../../../common/services/rag-tool-dependencies.js";
import {
  DEFAULT_WORKSPACE_BASE,
  resolveWorkspacePath,
} from "../../../common/services/workspace-path.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../../common/services/zod-tool-schema.js";

const SUPPORTED_EXTENSIONS = new Set([".pdf", ".txt", ".md", ".docx"]);

export const indexDocumentInputSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe("Relative path in this session workspace, e.g. uploads/contract.pdf."),
  displayName: z
    .string()
    .optional()
    .describe("Optional document display name in the RAG corpus."),
});

export class IndexDocumentTool implements Tool {
  name = "index_document";
  description =
    "Upload a workspace document to the app knowledge base and index it for Q&A. Supports PDF, TXT, MD, and DOCX.";
  inputSchema = zodSchemaToJsonInputSchema(indexDocumentInputSchema);

  constructor(
    _memoryManager: unknown,
    private readonly deps: RagToolDependencies,
  ) {}

  async run(input: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const args = parseToolInput(this.name, indexDocumentInputSchema, input);
    const filename = path.basename(args.path);
    const ext = path.extname(filename).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      throw new Error(`Unsupported RAG document type: ${ext || "unknown"}.`);
    }

    const absPath = resolveWorkspacePath(DEFAULT_WORKSPACE_BASE, context.sessionId, args.path);
    const buffer = await readFile(absPath);
    const document = await this.deps.corpusService.uploadAndIndex(
      buffer,
      filename,
      args.displayName,
    );

    return {
      indexed: true,
      message: "Document uploaded and indexed in the app knowledge base.",
      corpusName: await this.deps.corpusService.getCorpusName(),
      document,
    };
  }
}
