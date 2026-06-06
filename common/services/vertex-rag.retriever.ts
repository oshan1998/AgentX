import type { RetrievedContext, Retriever } from "../interfaces/retriever.js";
import type { CorpusService } from "./corpus.service.js";
import { VertexRagEngineService } from "./vertex-rag-engine.service.js";

export class VertexRagRetriever implements Retriever {
  constructor(
    private readonly ragEngine: VertexRagEngineService,
    private readonly corpusService: CorpusService,
  ) {}

  async getContext(
    question: string,
    options?: { sessionId?: string; topK?: number },
  ): Promise<RetrievedContext> {
    const corpusName = await this.corpusService.getCorpusName();
    const contexts = await this.ragEngine.retrieveContexts(corpusName, question, {
      topK: options?.topK,
    });
    const items = contexts?.contexts ?? [];

    return {
      text: items.map((item) => item.text ?? "").filter(Boolean).join("\n\n"),
      sources: items.map((item) => ({
        uri: item.sourceUri,
        title: item.sourceDisplayName,
      })),
    };
  }
}
