import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_WORKSPACE_BASE,
  normalizeWorkspaceRelativePath,
  resolveWorkspacePath,
} from "./workspace-path.js";

/** Matches src/href or url() values that look like workspace-relative asset paths. */
const ASSET_PATH_PATTERN =
  /((?:src|href)\s*=\s*["']|url\(\s*["']?)(?!https?:\/\/|data:|file:|#)([^"')]+)(["']?\)?)/gi;

function isWorkspaceRelativeAsset(ref: string): boolean {
  const trimmed = ref.trim();
  if (!trimmed.length) return false;
  if (trimmed.startsWith("//")) return false;
  return !trimmed.includes("://");
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
 * Embeds workspace-relative raster images as data: URIs (for environments where file:// is blocked).
 */
export async function embedWorkspaceImagesInHtml(
  html: string,
  sessionId: string,
  memoryBase: string = DEFAULT_WORKSPACE_BASE,
): Promise<string> {
  const { readFile } = await import("node:fs/promises");

  const imgSrcPattern = /src\s*=\s*["'](?!https?:\/\/|data:|file:)([^"']+)["']/gi;
  let result = html;
  const seen = new Map<string, string>();

  for (const match of html.matchAll(imgSrcPattern)) {
    const assetPath = match[1]?.trim();
    if (!assetPath || !isWorkspaceRelativeAsset(assetPath)) continue;
    if (seen.has(assetPath)) continue;

    const normalized = normalizeWorkspaceRelativePath(assetPath);
    const abs = resolveWorkspacePath(memoryBase, sessionId, normalized);
    const ext = path.extname(abs).toLowerCase();
    const mime =
      ext === ".png"
        ? "image/png"
        : ext === ".webp"
          ? "image/webp"
          : ext === ".gif"
            ? "image/gif"
            : ext === ".avif"
              ? "image/avif"
              : "image/jpeg";

    try {
      const buffer = await readFile(abs);
      const dataUri = `data:${mime};base64,${buffer.toString("base64")}`;
      seen.set(assetPath, dataUri);
    } catch {
      // leave original path if file missing
    }
  }

  for (const [assetPath, dataUri] of seen) {
    const escaped = assetPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(
      new RegExp(`src\\s*=\\s*["']${escaped}["']`, "gi"),
      `src="${dataUri}"`,
    );
  }

  return result;
}
