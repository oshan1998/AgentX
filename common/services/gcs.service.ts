import { Storage } from "@google-cloud/storage";
import path from "node:path";

export interface UploadedGcsFile {
  bucket: string;
  objectName: string;
  gcsUri: string;
  mimeType: string;
  originalName: string;
  sizeBytes: number;
}

const MIME_BY_EXTENSION = new Map<string, string>([
  [".pdf", "application/pdf"],
  [".txt", "text/plain"],
  [".md", "text/markdown"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
]);

function resolveBucketName(): string {
  const bucket = process.env.RAG_GCS_BUCKET || process.env.GCS_BUCKET || process.env.GCP_BUCKET_NAME;
  if (!bucket?.trim()) {
    throw new Error("Set RAG_GCS_BUCKET, GCS_BUCKET, or GCP_BUCKET_NAME for document RAG storage.");
  }
  return bucket.trim().replace(/^gs:\/\//, "").replace(/\/+$/, "");
}

function sanitizeObjectSegment(value: string): string {
  const cleaned = path.basename(value).replace(/[^\w.\-()+ ]/g, "_").trim();
  return cleaned.length > 0 ? cleaned.slice(0, 200) : "document";
}

export function inferMimeType(filename: string): string {
  return MIME_BY_EXTENSION.get(path.extname(filename).toLowerCase()) ?? "application/octet-stream";
}

export class GcsService {
  private readonly storage = new Storage();

  async uploadCorpusDocument(
    documentId: string,
    buffer: Buffer,
    originalName: string,
    mimeType = inferMimeType(originalName),
  ): Promise<UploadedGcsFile> {
    if (buffer.byteLength === 0) {
      throw new Error("Cannot upload an empty document.");
    }

    const safeId = sanitizeObjectSegment(documentId);
    const safeName = sanitizeObjectSegment(originalName);
    const bucketName = resolveBucketName();
    const objectName = `corpus/${safeId}/${safeName}`;
    const file = this.storage.bucket(bucketName).file(objectName);

    await file.save(buffer, {
      resumable: false,
      contentType: mimeType,
      metadata: {
        metadata: {
          documentId: safeId,
          originalName: safeName,
        },
      },
    });

    return {
      bucket: bucketName,
      objectName,
      gcsUri: `gs://${bucketName}/${objectName}`,
      mimeType,
      originalName: safeName,
      sizeBytes: buffer.byteLength,
    };
  }

  async uploadDocument(
    sessionId: string,
    buffer: Buffer,
    originalName: string,
    mimeType = inferMimeType(originalName),
  ): Promise<UploadedGcsFile> {
    if (buffer.byteLength === 0) {
      throw new Error("Cannot upload an empty document.");
    }

    const safeSession = sanitizeObjectSegment(sessionId || "default-session");
    const safeName = sanitizeObjectSegment(originalName);
    const bucketName = resolveBucketName();
    const objectName = `sessions/${safeSession}/rag/${Date.now()}-${safeName}`;
    const file = this.storage.bucket(bucketName).file(objectName);

    await file.save(buffer, {
      resumable: false,
      contentType: mimeType,
      metadata: {
        metadata: {
          sessionId: safeSession,
          originalName: safeName,
        },
      },
    });

    return {
      bucket: bucketName,
      objectName,
      gcsUri: `gs://${bucketName}/${objectName}`,
      mimeType,
      originalName: safeName,
      sizeBytes: buffer.byteLength,
    };
  }
}
