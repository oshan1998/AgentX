import { z } from "zod";
import type { Tool, ToolContext } from "../../../common/interfaces/types.js";
import type { RagToolDependencies } from "../../../common/services/rag-tool-dependencies.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../../common/services/zod-tool-schema.js";

export const askDocumentInputSchema = z.object({
  question: z
    .string()
    .min(1)
    .describe("Question to answer from the indexed documents."),
  topK: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe("Number of RAG contexts to retrieve. Defaults to 5."),
});

export class AskDocumentTool implements Tool {
  name = "ask_document";
  description =
    "Answer a question from the app knowledge base when the user needs information from indexed documents. Use ask_document or qa_document only when document content is relevant — not for general chat.";
  inputSchema = zodSchemaToJsonInputSchema(askDocumentInputSchema);

  constructor(
    _memoryManager: unknown,
    private readonly deps: RagToolDependencies,
  ) {}

  async run(input: Record<string, unknown>, _context: ToolContext): Promise<unknown> {
    const args = parseToolInput(this.name, askDocumentInputSchema, input);
    const corpusName = await this.deps.corpusService.getCorpusName();
    const answer = await this.deps.ragEngine.generateGroundedAnswer(corpusName, args.question, {
      topK: args.topK,
    });

    return {
      answer: answer.answer,
      corpusName: answer.corpusName,
      groundingMetadata: answer.groundingMetadata,
      citationMetadata: answer.citationMetadata,
    };
  }
}
