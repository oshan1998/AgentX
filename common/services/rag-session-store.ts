import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface IndexedRagDocument {
  displayName: string;
  gcsUri: string;
  operationName?: string;
  indexedAt: string;
}

export interface RagSessionState {
  sessionId: string;
  corpusName: string;
  documents: IndexedRagDocument[];
  updatedAt: string;
}

interface RagStoreFile {
  sessions: Record<string, RagSessionState>;
}

export class RagSessionStore {
  constructor(
    private readonly storePath = path.join(process.cwd(), "memory", "rag-sessions.json"),
  ) {}

  async get(sessionId: string): Promise<RagSessionState | undefined> {
    const data = await this.read();
    return data.sessions[sessionId];
  }

  async setCorpus(sessionId: string, corpusName: string): Promise<RagSessionState> {
    const data = await this.read();
    const existing = data.sessions[sessionId];
    const state: RagSessionState = {
      sessionId,
      corpusName,
      documents: existing?.documents ?? [],
      updatedAt: new Date().toISOString(),
    };
    data.sessions[sessionId] = state;
    await this.write(data);
    return state;
  }

  async addDocument(
    sessionId: string,
    corpusName: string,
    document: IndexedRagDocument,
  ): Promise<RagSessionState> {
    const data = await this.read();
    const existing = data.sessions[sessionId];
    const documents = [...(existing?.documents ?? []), document];
    const state: RagSessionState = {
      sessionId,
      corpusName,
      documents,
      updatedAt: new Date().toISOString(),
    };
    data.sessions[sessionId] = state;
    await this.write(data);
    return state;
  }

  private async read(): Promise<RagStoreFile> {
    try {
      const raw = await readFile(this.storePath, "utf-8");
      const parsed = JSON.parse(raw) as RagStoreFile;
      return { sessions: parsed.sessions ?? {} };
    } catch {
      return { sessions: {} };
    }
  }

  private async write(data: RagStoreFile): Promise<void> {
    await mkdir(path.dirname(this.storePath), { recursive: true });
    await writeFile(this.storePath, `${JSON.stringify(data, null, 2)}\n`);
  }
}
