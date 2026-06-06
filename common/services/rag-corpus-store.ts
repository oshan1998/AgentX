import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type DocumentIndexStatus = "pending" | "ready" | "failed";

export interface CorpusDocument {
  id: string;
  displayName: string;
  originalName: string;
  gcsUri: string;
  operationName?: string;
  status: DocumentIndexStatus;
  indexedAt: string;
  sizeBytes: number;
  error?: string;
}

export interface RagCorpusState {
  corpusName: string;
  documents: CorpusDocument[];
  updatedAt: string;
}

interface RagCorpusFile {
  corpusName?: string;
  documents?: CorpusDocument[];
  updatedAt?: string;
}

export class RagCorpusStore {
  constructor(
    private readonly storePath = path.join(process.cwd(), "memory", "rag-corpus.json"),
  ) {}

  async getState(): Promise<RagCorpusState | undefined> {
    const data = await this.read();
    if (!data.corpusName) return undefined;
    return {
      corpusName: data.corpusName,
      documents: data.documents ?? [],
      updatedAt: data.updatedAt ?? new Date().toISOString(),
    };
  }

  async getCorpusName(): Promise<string | undefined> {
    const data = await this.read();
    return data.corpusName;
  }

  async setCorpus(corpusName: string): Promise<RagCorpusState> {
    const data = await this.read();
    const state: RagCorpusState = {
      corpusName,
      documents: data.documents ?? [],
      updatedAt: new Date().toISOString(),
    };
    await this.write(state);
    return state;
  }

  async addDocument(document: CorpusDocument): Promise<RagCorpusState> {
    const data = await this.read();
    if (!data.corpusName) {
      throw new Error("Corpus is not initialized.");
    }
    const state: RagCorpusState = {
      corpusName: data.corpusName,
      documents: [...(data.documents ?? []), document],
      updatedAt: new Date().toISOString(),
    };
    await this.write(state);
    return state;
  }

  async updateDocument(
    id: string,
    patch: Partial<Pick<CorpusDocument, "status" | "operationName" | "error">>,
  ): Promise<CorpusDocument | undefined> {
    const data = await this.read();
    if (!data.corpusName) return undefined;

    const documents = [...(data.documents ?? [])];
    const index = documents.findIndex((doc) => doc.id === id);
    if (index < 0) return undefined;

    documents[index] = { ...documents[index], ...patch };
    await this.write({
      corpusName: data.corpusName,
      documents,
      updatedAt: new Date().toISOString(),
    });
    return documents[index];
  }

  async listDocuments(): Promise<CorpusDocument[]> {
    const data = await this.read();
    return data.documents ?? [];
  }

  async hasReadyDocuments(): Promise<boolean> {
    const docs = await this.listDocuments();
    return docs.some((doc) => doc.status === "ready");
  }

  private async read(): Promise<RagCorpusFile> {
    try {
      const raw = await readFile(this.storePath, "utf-8");
      return JSON.parse(raw) as RagCorpusFile;
    } catch {
      return {};
    }
  }

  private async write(state: RagCorpusState): Promise<void> {
    await mkdir(path.dirname(this.storePath), { recursive: true });
    await writeFile(this.storePath, `${JSON.stringify(state, null, 2)}\n`);
  }
}
