import { randomUUID } from "node:crypto";
import path from "node:path";
import { GcsService, inferMimeType } from "./gcs.service.js";
import type { CorpusDocument } from "./rag-corpus-store.js";
import { RagCorpusStore } from "./rag-corpus-store.js";
import { VertexRagEngineService } from "./vertex-rag-engine.service.js";

const SUPPORTED_EXTENSIONS = new Set([".pdf", ".txt", ".md", ".docx"]);
const IMPORT_TIMEOUT_MS = 300_000;

export class CorpusService {
  private initPromise?: Promise<string>;

  constructor(
    private readonly ragEngine: VertexRagEngineService,
    private readonly gcsService: GcsService,
    private readonly corpusStore: RagCorpusStore,
  ) {}

  async ensureCorpus(): Promise<string> {
    if (!this.initPromise) {
      this.initPromise = this.bootstrapCorpus();
    }
    return this.initPromise;
  }

  async getCorpusName(): Promise<string> {
    return this.ensureCorpus();
  }

  async listDocuments(): Promise<CorpusDocument[]> {
    await this.ensureCorpus();
    return this.corpusStore.listDocuments();
  }

  async hasReadyDocuments(): Promise<boolean> {
    await this.ensureCorpus();
    return this.corpusStore.hasReadyDocuments();
  }

  async uploadAndIndex(
    buffer: Buffer,
    originalName: string,
    displayName?: string,
  ): Promise<CorpusDocument> {
    const ext = path.extname(originalName).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      throw new Error(
        `Unsupported document type: ${ext || "unknown"}. Supported: PDF, TXT, MD, DOCX.`,
      );
    }
    if (buffer.byteLength === 0) {
      throw new Error("Cannot upload an empty document.");
    }

    const corpusName = await this.ensureCorpus();
    const documentId = randomUUID();
    const uploaded = await this.gcsService.uploadCorpusDocument(
      documentId,
      buffer,
      originalName,
      inferMimeType(originalName),
    );

    const pendingDoc: CorpusDocument = {
      id: documentId,
      displayName: displayName?.trim() || originalName,
      originalName,
      gcsUri: uploaded.gcsUri,
      status: "pending",
      indexedAt: new Date().toISOString(),
      sizeBytes: uploaded.sizeBytes,
    };
    await this.corpusStore.addDocument(pendingDoc);

    try {
      const importResult = await this.ragEngine.importGcsFile(corpusName, uploaded.gcsUri);
      if (importResult.operationName) {
        await this.ragEngine.waitForImportOperation(importResult.operationName, IMPORT_TIMEOUT_MS);
      }
      const updated = await this.corpusStore.updateDocument(documentId, {
        status: "ready",
        operationName: importResult.operationName,
      });
      return updated ?? { ...pendingDoc, status: "ready", operationName: importResult.operationName };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.corpusStore.updateDocument(documentId, { status: "failed", error: message });
      throw new Error(`Indexing failed: ${message}`);
    }
  }

  async answerQuestion(question: string, options?: { topK?: number }): Promise<string> {
    return this.generateGroundedAnswer(question, options);
  }

  async retrieveContexts(question: string, options?: { topK?: number }) {
    const corpusName = await this.requireReadyCorpus();
    return this.ragEngine.retrieveContexts(corpusName, question, { topK: options?.topK });
  }

  async generateGroundedAnswer(question: string, options?: { topK?: number }): Promise<string> {
    const corpusName = await this.requireReadyCorpus();
    const result = await this.ragEngine.generateGroundedAnswer(corpusName, question, {
      topK: options?.topK,
    });
    return result.answer;
  }

  private async requireReadyCorpus(): Promise<string> {
    const corpusName = await this.ensureCorpus();
    const hasDocs = await this.corpusStore.hasReadyDocuments();
    if (!hasDocs) {
      throw new Error("No indexed documents in the knowledge base. Upload documents first.");
    }
    return corpusName;
  }

  private async bootstrapCorpus(): Promise<string> {
    const configured = process.env.RAG_CORPUS_NAME?.trim();
    if (configured) {
      await this.corpusStore.setCorpus(configured);
      return configured;
    }

    const existing = await this.corpusStore.getCorpusName();
    if (existing) return existing;

    const corpusName = await this.ragEngine.createCorpus(
      "agentx-knowledge-base",
      "AgentX application knowledge base",
    );
    await this.corpusStore.setCorpus(corpusName);
    return corpusName;
  }
}
