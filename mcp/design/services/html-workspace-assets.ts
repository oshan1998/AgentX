import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_WORKSPACE_BASE,
  normalizeWorkspaceRelativePath,
  resolveWorkspacePath,
} from "../../_shared/workspace-path.js";
import { logger } from "../../_shared/logger.js";

/** Matches src/href or url() values that look like local asset paths. */
const LOCAL_ASSET_PATTERN =
  /((?:src|href)\s*=\s*["']|url\(\s*["']?)(?!https?:\/\/|data:|#)([^"')]+)(["']?\)?)/gi;

const SRCSET_PATTERN = /srcset\s*=\s*["']([^"']+)["']/gi;

/** HTTP URLs pointing at a session workspace file → workspace-relative path. */
const SESSION_WORKSPACE_URL_PATTERN =
  /https?:\/\/[^/"'\s)]+\/workspace\/sessions\/[^/"'\s)]+\/workspace\/([^"'\s)]+)/gi;

export type EmbedWorkspaceAssetsResult = {
  html: string;
  warnings: string[];
};

function mimeForPath(absPath: string): string {
  const ext = path.extname(absPath).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".avif":
      return "image/avif";
    case ".svg":
      return "image/svg+xml";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    default:
      return "application/octet-stream";
  }
}

/** Normalize refs agents may emit (localhost workspace URLs, ./ prefixes, workspace/ prefix). */
export function normalizeAssetRef(ref: string): string {
  const trimmed = ref.trim();
  const sessionMatch = trimmed.match(/\/workspace\/sessions\/[^/]+\/workspace\/(.+)$/i);
  if (sessionMatch?.[1]) {
    return normalizeWorkspaceRelativePath(sessionMatch[1]);
  }
  return normalizeWorkspaceRelativePath(trimmed.replace(/^\.\//, ""));
}

function resolveLocalAssetToAbsolute(
  ref: string,
  sessionId: string,
  memoryBase: string,
): string | null {
  const normalized = normalizeAssetRef(ref);
  if (!normalized.length || normalized.startsWith("//")) return null;
  if (/^https?:\/\//i.test(normalized) || normalized.startsWith("data:") || normalized.startsWith("#")) {
    return null;
  }

  if (ref.trim().startsWith("file://")) {
    try {
      return fileURLToPath(ref.trim());
    } catch {
      return null;
    }
  }

  if (normalized.includes("://")) return null;

  return resolveWorkspacePath(memoryBase, sessionId, normalized);
}

function collectSrcsetAssetRefs(html: string): string[] {
  const refs: string[] = [];
  for (const match of html.matchAll(SRCSET_PATTERN)) {
    const srcsetValue = match[1];
    if (!srcsetValue) continue;
    for (const candidate of srcsetValue.split(",")) {
      const url = candidate.trim().split(/\s+/)[0];
      if (url && !/^https?:\/\//i.test(url) && !url.startsWith("data:")) {
        refs.push(url);
      }
    }
  }
  return refs;
}

function rewriteSessionWorkspaceUrls(html: string): string {
  return html.replace(SESSION_WORKSPACE_URL_PATTERN, (_, relPath: string) =>
    normalizeWorkspaceRelativePath(relPath),
  );
}

function replaceAssetRefInHtml(html: string, assetRef: string, replacement: string): string {
  const escaped = assetRef.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let result = html.replace(
    new RegExp(
      `((?:src|href)\\s*=\\s*["']|url\\(\\s*["']?)${escaped}(["']?\\)?)`,
      "gi",
    ),
    `$1${replacement}$2`,
  );

  result = result.replace(SRCSET_PATTERN, (match, srcsetValue: string) => {
    let updated = srcsetValue;
    for (const part of srcsetValue.split(",")) {
      const trimmedPart = part.trim();
      const url = trimmedPart.split(/\s+/)[0];
      if (url === assetRef) {
        updated = updated.replace(url, replacement);
      }
    }
    return match.replace(srcsetValue, updated);
  });

  return result;
}

/**
 * Inlines local workspace assets (workspace-relative, file://, or session workspace HTTP URLs)
 * as data: URIs. Required for Puppeteer setContent(), which blocks file:// subresources
 * from about:blank.
 */
export async function embedWorkspaceImagesInHtml(
  html: string,
  sessionId: string,
  memoryBase: string = DEFAULT_WORKSPACE_BASE,
): Promise<EmbedWorkspaceAssetsResult> {
  const { readFile } = await import("node:fs/promises");

  const warnings: string[] = [];
  let result = rewriteSessionWorkspaceUrls(html);
  const seen = new Map<string, string>();
  const assetRefs = new Set<string>();

  for (const match of result.matchAll(LOCAL_ASSET_PATTERN)) {
    const assetRef = match[2]?.trim();
    if (assetRef) assetRefs.add(assetRef);
  }
  for (const ref of collectSrcsetAssetRefs(result)) {
    assetRefs.add(ref);
  }

  for (const assetRef of assetRefs) {
    if (seen.has(assetRef)) continue;

    const abs = resolveLocalAssetToAbsolute(assetRef, sessionId, memoryBase);
    if (!abs) {
      if (!/^https?:\/\//i.test(assetRef) && !assetRef.startsWith("data:")) {
        const message = `Could not embed workspace asset "${assetRef}": not a resolvable workspace path`;
        warnings.push(message);
        logger.warn(message);
      }
      continue;
    }

    try {
      const buffer = await readFile(abs);
      const dataUri = `data:${mimeForPath(abs)};base64,${buffer.toString("base64")}`;
      seen.set(assetRef, dataUri);
    } catch {
      const message = `Could not embed workspace asset "${assetRef}": file not found or unreadable`;
      warnings.push(message);
      logger.warn(message);
    }
  }

  for (const [assetRef, dataUri] of seen) {
    result = replaceAssetRefInHtml(result, assetRef, dataUri);
  }

  return { html: result, warnings };
}
