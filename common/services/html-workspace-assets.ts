import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  DEFAULT_WORKSPACE_BASE,
  normalizeWorkspaceRelativePath,
  resolveWorkspacePath,
} from "./workspace-path.js";

/** Matches src/href or url() values that look like workspace-relative asset paths. */
const ASSET_PATH_PATTERN =
  /((?:src|href)\s*=\s*["']|url\(\s*["']?)(?!https?:\/\/|data:|file:|#)([^"')]+)(["']?\)?)/gi;

/** Like ASSET_PATH_PATTERN but also matches file:// refs for inlining. */
const LOCAL_ASSET_PATTERN =
  /((?:src|href)\s*=\s*["']|url\(\s*["']?)(?!https?:\/\/|data:|#)([^"')]+)(["']?\)?)/gi;

function isWorkspaceRelativeAsset(ref: string): boolean {
  const trimmed = ref.trim();
  if (!trimmed.length) return false;
  if (trimmed.startsWith("//")) return false;
  return !trimmed.includes("://");
}

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

function resolveLocalAssetToAbsolute(
  ref: string,
  sessionId: string,
  memoryBase: string,
): string | null {
  const trimmed = ref.trim();
  if (!trimmed.length || trimmed.startsWith("//")) return null;
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("data:") || trimmed.startsWith("#")) {
    return null;
  }

  if (trimmed.startsWith("file://")) {
    try {
      return fileURLToPath(trimmed);
    } catch {
      return null;
    }
  }

  if (trimmed.includes("://")) return null;

  const normalized = normalizeWorkspaceRelativePath(trimmed);
  return resolveWorkspacePath(memoryBase, sessionId, normalized);
}

function toFileUrl(memoryBase: string, sessionId: string, relativePath: string): string {
  const normalized = normalizeWorkspaceRelativePath(relativePath);
  const abs = resolveWorkspacePath(memoryBase, sessionId, normalized);
  return pathToFileURL(abs).href;
}

/**
 * Rewrites workspace-relative image URLs in HTML to file:// URLs
 * so headless Chrome can load session assets.
 */
export function resolveWorkspaceAssetsInHtml(
  html: string,
  sessionId: string,
  memoryBase: string = DEFAULT_WORKSPACE_BASE,
): string {
  return html.replace(ASSET_PATH_PATTERN, (match, prefix, assetPath, suffix) => {
    if (!isWorkspaceRelativeAsset(assetPath)) {
      return match;
    }
    const fileUrl = toFileUrl(memoryBase, sessionId, assetPath);
    return `${prefix}${fileUrl}${suffix}`;
  });
}

/**
 * Inlines local workspace assets (workspace-relative or file:// paths) as data: URIs.
 * Required for Puppeteer setContent(), which blocks file:// subresources from about:blank.
 */
export async function embedWorkspaceImagesInHtml(
  html: string,
  sessionId: string,
  memoryBase: string = DEFAULT_WORKSPACE_BASE,
): Promise<string> {
  const { readFile } = await import("node:fs/promises");

  let result = html;
  const seen = new Map<string, string>();

  for (const match of html.matchAll(LOCAL_ASSET_PATTERN)) {
    const assetRef = match[2]?.trim();
    if (!assetRef || seen.has(assetRef)) continue;

    const abs = resolveLocalAssetToAbsolute(assetRef, sessionId, memoryBase);
    if (!abs) continue;

    try {
      const buffer = await readFile(abs);
      const dataUri = `data:${mimeForPath(abs)};base64,${buffer.toString("base64")}`;
      seen.set(assetRef, dataUri);
    } catch {
      // leave original path if file missing
    }
  }

  for (const [assetRef, dataUri] of seen) {
    const escaped = assetRef.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(
      new RegExp(
        `((?:src|href)\\s*=\\s*["']|url\\(\\s*["']?)${escaped}(["']?\\)?)`,
        "gi",
      ),
      `$1${dataUri}$2`,
    );
  }

  return result;
}
