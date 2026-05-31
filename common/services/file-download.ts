import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_WORKSPACE_BASE,
  resolveWorkspacePath,
} from "./workspace-path.js";

export const ALLOWED_IMAGE_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);

export const DEFAULT_ALLOWED_CONTENT_TYPES = new Set([
  ...ALLOWED_IMAGE_CONTENT_TYPES,
  "application/pdf",
  "application/json",
  "text/plain",
  "text/csv",
  "font/woff",
  "font/woff2",
  "font/ttf",
  "font/otf",
  "application/font-woff",
  "application/font-woff2",
]);

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/avif": ".avif",
  "application/pdf": ".pdf",
  "application/json": ".json",
  "text/plain": ".txt",
  "text/csv": ".csv",
  "font/woff": ".woff",
  "font/woff2": ".woff2",
  "font/ttf": ".ttf",
  "font/otf": ".otf",
  "application/font-woff": ".woff",
  "application/font-woff2": ".woff2",
};

const URL_EXT_HINTS: [suffix: string, ext: string][] = [
  [".jpg", ".jpg"],
  [".jpeg", ".jpeg"],
  [".png", ".png"],
  [".webp", ".webp"],
  [".gif", ".gif"],
  [".avif", ".avif"],
  [".pdf", ".pdf"],
  [".json", ".json"],
  [".txt", ".txt"],
  [".csv", ".csv"],
  [".woff", ".woff"],
  [".woff2", ".woff2"],
  [".ttf", ".ttf"],
  [".otf", ".otf"],
];

export const DEFAULT_MAX_BYTES = 15 * 1024 * 1024;

export type DownloadProfile = "image" | "default";

export function allowedContentTypesForProfile(profile: DownloadProfile): Set<string> {
  return profile === "image" ? ALLOWED_IMAGE_CONTENT_TYPES : DEFAULT_ALLOWED_CONTENT_TYPES;
}

export function normalizeContentType(contentType: string | null): string | null {
  if (!contentType) return null;
  return contentType.split(";")[0]?.trim().toLowerCase() ?? null;
}

export function isAllowedContentType(
  contentType: string | null,
  allowed: Set<string>,
): boolean {
  const normalized = normalizeContentType(contentType);
  return normalized ? allowed.has(normalized) : false;
}

export function inferFileExtension(
  contentType: string | null,
  url: string,
  fallbackExt = ".bin",
): string {
  const normalized = normalizeContentType(contentType);
  if (normalized && EXT_BY_CONTENT_TYPE[normalized]) {
    return EXT_BY_CONTENT_TYPE[normalized];
  }
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    for (const [suffix, ext] of URL_EXT_HINTS) {
      if (pathname.endsWith(suffix)) return ext;
    }
  } catch {
    // ignore invalid URL for extension inference
  }
  return fallbackExt;
}

export function ensureOutputExtension(outputPath: string, ext: string): string {
  const current = path.extname(outputPath).toLowerCase();
  if (current.length) return outputPath;
  return outputPath + ext;
}

export interface DownloadFromUrlOptions {
  url: string;
  maxBytes?: number;
  timeoutMs?: number;
  allowedContentTypes: Set<string>;
  acceptHeader?: string;
  resourceLabel?: string;
}

export interface DownloadFromUrlResult {
  buffer: Buffer;
  contentType: string;
  sizeBytes: number;
}

function allowedTypesDescription(allowed: Set<string>): string {
  const short = [...allowed].map((t) => t.split("/")[1] ?? t).slice(0, 12);
  const suffix = allowed.size > short.length ? ", …" : "";
  return short.join(", ") + suffix;
}

/**
 * Fetches a file over HTTPS with size and content-type guards.
 */
export async function downloadFromUrl(
  options: DownloadFromUrlOptions,
): Promise<DownloadFromUrlResult> {
  const {
    url,
    maxBytes = DEFAULT_MAX_BYTES,
    timeoutMs = 30000,
    allowedContentTypes,
    acceptHeader = "*/*",
    resourceLabel = "file",
  } = options;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid ${resourceLabel} URL: ${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`Only HTTPS ${resourceLabel} URLs are supported.`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { Accept: acceptHeader },
    });

    if (!response.ok) {
      throw new Error(`${resourceLabel} download failed (${response.status}): ${url}`);
    }

    const contentType = response.headers.get("content-type");
    if (!isAllowedContentType(contentType, allowedContentTypes)) {
      throw new Error(
        `Unsupported content-type "${contentType ?? "unknown"}". Allowed: ${allowedTypesDescription(allowedContentTypes)}.`,
      );
    }

    const normalizedType = normalizeContentType(contentType)!;
    const contentLength = response.headers.get("content-length");
    if (contentLength && Number(contentLength) > maxBytes) {
      throw new Error(`${resourceLabel} exceeds max size (${maxBytes} bytes).`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error(`${resourceLabel} response has no body.`);
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.length;
      if (total > maxBytes) {
        throw new Error(`${resourceLabel} exceeds max size (${maxBytes} bytes).`);
      }
      chunks.push(value);
    }

    const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    return {
      buffer,
      contentType: normalizedType,
      sizeBytes: buffer.length,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function writeDownloadToWorkspace(
  sessionId: string,
  outputPath: string,
  buffer: Buffer,
  inferredExt: string,
): Promise<string> {
  const finalPath = ensureOutputExtension(outputPath, inferredExt);
  const absOutput = resolveWorkspacePath(
    DEFAULT_WORKSPACE_BASE,
    sessionId,
    finalPath,
  );
  await mkdir(path.dirname(absOutput), { recursive: true });
  await writeFile(absOutput, buffer);
  return finalPath;
}
