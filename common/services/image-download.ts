const ALLOWED_IMAGE_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/avif": ".avif",
};

const DEFAULT_MAX_BYTES = 15 * 1024 * 1024;

export function inferImageExtension(contentType: string | null, url: string): string {
  if (contentType) {
    const normalized = contentType.split(";")[0]?.trim().toLowerCase();
    if (normalized && EXT_BY_CONTENT_TYPE[normalized]) {
      return EXT_BY_CONTENT_TYPE[normalized];
    }
  }
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return ".jpg";
    if (pathname.endsWith(".png")) return ".png";
    if (pathname.endsWith(".webp")) return ".webp";
    if (pathname.endsWith(".gif")) return ".gif";
    if (pathname.endsWith(".avif")) return ".avif";
  } catch {
    // ignore invalid URL for extension inference
  }
  return ".jpg";
}

export function isAllowedImageContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const normalized = contentType.split(";")[0]?.trim().toLowerCase();
  return normalized ? ALLOWED_IMAGE_CONTENT_TYPES.has(normalized) : false;
}

export interface DownloadImageOptions {
  url: string;
  maxBytes?: number;
  timeoutMs?: number;
}

export interface DownloadImageResult {
  buffer: Buffer;
  contentType: string;
  sizeBytes: number;
}

/**
 * Fetches an image over HTTPS with size and content-type guards.
 */
export async function downloadImageFromUrl(
  options: DownloadImageOptions,
): Promise<DownloadImageResult> {
  const { url, maxBytes = DEFAULT_MAX_BYTES, timeoutMs = 30000 } = options;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid image URL: ${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Only HTTPS image URLs are supported.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { Accept: "image/*" },
    });

    if (!response.ok) {
      throw new Error(`Image download failed (${response.status}): ${url}`);
    }

    const contentType = response.headers.get("content-type");
    if (!isAllowedImageContentType(contentType)) {
      throw new Error(
        `Unsupported content-type "${contentType ?? "unknown"}". Allowed: jpeg, png, webp, gif, avif.`,
      );
    }

    const normalizedType = contentType!.split(";")[0]!.trim().toLowerCase();
    const contentLength = response.headers.get("content-length");
    if (contentLength && Number(contentLength) > maxBytes) {
      throw new Error(`Image exceeds max size (${maxBytes} bytes).`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Image response has no body.");
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.length;
      if (total > maxBytes) {
        throw new Error(`Image exceeds max size (${maxBytes} bytes).`);
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
