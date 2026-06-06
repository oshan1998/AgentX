export interface DocumentSource {
  uri?: string;
  title?: string;
}

export interface RetrievedContext {
  text: string;
  sources: DocumentSource[];
}

export interface Retriever {
  getContext(
    question: string,
    options?: {
      sessionId?: string;
      topK?: number;
    },
  ): Promise<RetrievedContext>;
}
