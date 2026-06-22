import {
  allowedContentTypesForProfile,
  DEFAULT_MAX_BYTES,
  downloadFromUrl,
  inferFileExtension,
  isAllowedContentType,
  ALLOWED_IMAGE_CONTENT_TYPES,
  type DownloadFromUrlResult,
} from "../../_shared/file-download.js";

export { ALLOWED_IMAGE_CONTENT_TYPES };

export function inferImageExtension(contentType: string | null, url: string): string {
  return inferFileExtension(contentType, url, ".jpg");
}

export function isAllowedImageContentType(contentType: string | null): boolean {
  return isAllowedContentType(contentType, ALLOWED_IMAGE_CONTENT_TYPES);
}

export interface DownloadImageOptions {
  url: string;
  maxBytes?: number;
  timeoutMs?: number;
}

export type DownloadImageResult = DownloadFromUrlResult;

/**
 * Fetches an image over HTTPS with size and content-type guards.
 */
export async function downloadImageFromUrl(
  options: DownloadImageOptions,
): Promise<DownloadImageResult> {
  const { url, maxBytes = DEFAULT_MAX_BYTES, timeoutMs = 30000 } = options;
  return downloadFromUrl({
    url,
    maxBytes,
    timeoutMs,
    allowedContentTypes: allowedContentTypesForProfile("image"),
    acceptHeader: "image/*",
    resourceLabel: "Image",
  });
}
