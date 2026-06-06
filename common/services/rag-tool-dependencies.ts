import type { Retriever } from "../interfaces/retriever.js";
import type { CorpusService } from "./corpus.service.js";
import { GcsService } from "./gcs.service.js";
import { VertexRagEngineService } from "./vertex-rag-engine.service.js";

export interface RagToolDependencies {
  gcsService: GcsService;
  ragEngine: VertexRagEngineService;
  corpusService: CorpusService;
  retriever: Retriever;
}
