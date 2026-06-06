import { GoogleAuth } from "google-auth-library";
import { resolveVertexLocation, resolveVertexProject } from "../../llm-adapters/vertex-config.js";

const SERVERLESS_RAG_LOCATION = "us-central1";
const CORPUS_CREATE_TIMEOUT_MS = 180_000;

interface VertexResponse {
  name?: string;
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    groundingMetadata?: unknown;
    citationMetadata?: unknown;
  }>;
  contexts?: {
    contexts?: Array<{
      text?: string;
      sourceUri?: string;
      sourceDisplayName?: string;
    }>;
  };
  ragManagedDbConfig?: {
    serverless?: Record<string, unknown>;
    spanner?: Record<string, unknown>;
  };
}

interface VertexOperationResponse extends VertexResponse {
  done?: boolean;
  response?: VertexResponse;
  error?: {
    message?: string;
  };
}

export interface RagImportResult {
  operationName?: string;
}

export interface RagAnswer {
  answer: string;
  corpusName: string;
  groundingMetadata?: unknown;
  citationMetadata?: unknown;
}

export class VertexRagEngineService {
  private readonly auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });

  /**
   * Serverless mode is a project-level setting in us-central1.
   * See: https://cloud.google.com/vertex-ai/generative-ai/docs/rag-engine/switching-modes
   */
  async ensureServerlessMode(): Promise<void> {
    if (this.resolveRagLocation() !== SERVERLESS_RAG_LOCATION) {
      return;
    }

    const config = await this.request<VertexResponse>("GET", this.ragEngineConfigUrl());
    if (config.ragManagedDbConfig?.serverless) {
      return;
    }

    await this.request("PATCH", this.ragEngineConfigUrl(), {
      ragManagedDbConfig: { serverless: {} },
    });
  }

  async createCorpus(displayName: string, description?: string): Promise<string> {
    await this.ensureServerlessMode();

    const response = await this.request<VertexOperationResponse>("POST", this.corporaUrl(), {
      display_name: displayName,
      description,
    });

    const name = await this.resolveCreatedResourceName(response);
    if (!name) {
      throw new Error("Vertex RAG Engine did not return a corpus name.");
    }
    return name;
  }

  async importGcsFile(
    corpusName: string,
    gcsUri: string,
    options?: { chunkSize?: number; chunkOverlap?: number },
  ): Promise<RagImportResult> {
    const response = await this.request<VertexOperationResponse>(
      "POST",
      `${this.apiBase()}/${corpusName}/ragFiles:import`,
      {
        import_rag_files_config: {
          gcs_source: {
            uris: [gcsUri],
          },
          rag_file_chunking_config: {
            chunk_size: options?.chunkSize ?? 1024,
            chunk_overlap: options?.chunkOverlap ?? 256,
          },
        },
      },
    );

    return { operationName: response.name };
  }

  async retrieveContexts(
    corpusName: string,
    question: string,
    options?: { topK?: number },
  ): Promise<VertexResponse["contexts"]> {
    const response = await this.request("POST", `${this.locationUrl()}:retrieveContexts`, {
      vertex_rag_store: {
        rag_resources: [{ rag_corpus: corpusName }],
      },
      query: {
        text: question,
        rag_retrieval_config: {
          top_k: options?.topK ?? 5,
        },
      },
    });

    return response.contexts;
  }

  async generateGroundedAnswer(
    corpusName: string,
    question: string,
    options?: { topK?: number },
  ): Promise<RagAnswer> {
    const response = await this.request("POST", this.generateContentUrl(), {
      contents: {
        role: "user",
        parts: {
          text:
            "Answer the question using only the retrieved document context. " +
            "If the answer is not in the documents, say you could not find it.\n\n" +
            `Question: ${question}`,
        },
      },
      tools: {
        retrieval: {
          disable_attribution: false,
          vertex_rag_store: {
            rag_resources: [{ rag_corpus: corpusName }],
            rag_retrieval_config: {
              top_k: options?.topK ?? 5,
            },
          },
        },
      },
    });

    const candidate = response.candidates?.[0];
    const answer = candidate?.content?.parts?.map((part) => part.text ?? "").join("").trim();
    if (!answer) {
      throw new Error("Vertex RAG Engine returned an empty answer.");
    }

    return {
      answer,
      corpusName,
      groundingMetadata: candidate?.groundingMetadata,
      citationMetadata: candidate?.citationMetadata,
    };
  }

  private async request<T extends VertexResponse>(
    method: "GET" | "POST" | "PATCH",
    url: string,
    data?: unknown,
  ): Promise<T> {
    try {
      const response = await this.auth.request<T>({
        url,
        method,
        data,
      });
      return response.data;
    } catch (error) {
      throw new Error(this.formatRequestError(error));
    }
  }

  private formatRequestError(error: unknown): string {
    if (error && typeof error === "object") {
      const maybe = error as {
        message?: string;
        response?: { data?: unknown; status?: number };
      };
      const data = maybe.response?.data;
      if (typeof data === "string" && data.trim().startsWith("<!DOCTYPE html>")) {
        return `Vertex RAG API returned HTTP ${maybe.response?.status ?? "error"}. Check RAG location, corpus name, and deployment mode.`;
      }
      if (data && typeof data === "object" && "error" in data) {
        const apiError = (data as { error?: { message?: string } }).error?.message;
        if (apiError) return apiError;
      }
      if (maybe.message) return maybe.message;
    }
    return String(error);
  }

  private async resolveCreatedResourceName(response: VertexOperationResponse): Promise<string | undefined> {
    if (!response.name?.includes("/operations/")) {
      return response.name;
    }

    const operation = await this.waitForOperation(response.name, CORPUS_CREATE_TIMEOUT_MS);
    if (operation.error?.message) {
      throw new Error(`Vertex RAG corpus creation failed: ${operation.error.message}`);
    }
    return operation.response?.name;
  }

  async waitForImportOperation(operationName: string, timeoutMs = 300_000): Promise<void> {
    const operation = await this.waitForOperation(operationName, timeoutMs);
    if (operation.error?.message) {
      throw new Error(`Vertex RAG import failed: ${operation.error.message}`);
    }
  }

  private async waitForOperation(operationName: string, timeoutMs: number): Promise<VertexOperationResponse> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const operation = await this.request<VertexOperationResponse>(
        "GET",
        `${this.apiBase()}/${operationName}`,
      );
      if (operation.done) {
        return operation;
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    throw new Error(`Timed out waiting for Vertex operation: ${operationName}`);
  }

  private apiBase(): string {
    const location = this.resolveRagLocation();
    return `https://${location}-aiplatform.googleapis.com/v1beta1`;
  }

  private locationUrl(): string {
    return `${this.apiBase()}/projects/${resolveVertexProject()}/locations/${this.resolveRagLocation()}`;
  }

  private corporaUrl(): string {
    return `${this.locationUrl()}/ragCorpora`;
  }

  private ragEngineConfigUrl(): string {
    return `${this.apiBase()}/projects/${resolveVertexProject()}/locations/${SERVERLESS_RAG_LOCATION}/ragEngineConfig`;
  }

  private generateContentUrl(): string {
    const model = process.env.RAG_GEMINI_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash";
    return `${this.locationUrl()}/publishers/google/models/${model}:generateContent`;
  }

  private resolveRagLocation(): string {
    return process.env.RAG_LOCATION?.trim() || resolveVertexLocation();
  }
}
