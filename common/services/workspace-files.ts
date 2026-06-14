import { access, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_WORKSPACE_BASE,
  resolveWorkspacePath,
} from "./workspace-path.js";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const UPLOADS_DIR = "uploads";

const ALLOWED_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".pdf",
  ".txt",
  ".md",
  ".json",
  ".csv",
  ".html",
  ".htm",
  ".xml",
]);

export interface SavedWorkspaceFile {
  path: string;
  sizeBytes: number;
  originalName: string;
}

export interface WorkspaceFileEntry {
  path: string;
  name: string;
  sizeBytes: number;
}

/** Strip path segments and unsafe characters from a client-provided filename. */
export function sanitizeUploadFilename(originalName: string): string {
  const base = path.basename(originalName).replace(/[^\w.\-()+ ]/g, "_");
  const trimmed = base.trim().slice(0, 200);
  return trimmed.length > 0 ? trimmed : "upload.bin";
}

function assertAllowedExtension(filename: string): void {
  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(
      `File type not allowed (${ext || "no extension"}). Allowed: ${[...ALLOWED_EXTENSIONS].join(", ")}`,
    );
  }
}

function normalizeRelativeUploadPath(userPath: string | undefined, filename: string): string {
  const safeName = sanitizeUploadFilename(filename);
  if (!userPath?.trim()) {
    return `${UPLOADS_DIR}/${safeName}`;
  }
  const rel = userPath.replace(/^workspace\/?/i, "").replace(/^\/+/, "");
  if (rel.includes("..")) {
    throw new Error("Invalid path");
  }
  return rel;
}

async function uniquePath(
  sessionId: string,
  relativePath: string,
): Promise<string> {
  const abs = resolveWorkspacePath(
    DEFAULT_WORKSPACE_BASE,
    sessionId,
    relativePath,
  );
  try {
    await access(abs);
  } catch {
    return relativePath;
  }
  const dir = path.posix.dirname(relativePath.replace(/\\/g, "/"));
  const ext = path.extname(relativePath);
  const stem = path.basename(relativePath, ext);
  const stamp = Date.now();
  const candidate = path.posix.join(dir, `${stem}-${stamp}${ext}`);
  return candidate.replace(/\\/g, "/");
}

export async function saveWorkspaceFile(
  sessionId: string,
  buffer: Buffer,
  options: { originalName: string; relativePath?: string },
): Promise<SavedWorkspaceFile> {
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error(`File exceeds maximum size of ${MAX_UPLOAD_BYTES} bytes`);
  }
  if (buffer.byteLength === 0) {
    throw new Error("Empty file");
  }

  const safeName = sanitizeUploadFilename(options.originalName);
  assertAllowedExtension(safeName);

  let relativePath = normalizeRelativeUploadPath(
    options.relativePath,
    safeName,
  );
  if (!relativePath.toLowerCase().startsWith(`${UPLOADS_DIR}/`)) {
    relativePath = `${UPLOADS_DIR}/${safeName}`;
  }
  assertAllowedExtension(path.basename(relativePath));

  relativePath = await uniquePath(sessionId, relativePath);
  const absPath = resolveWorkspacePath(
    DEFAULT_WORKSPACE_BASE,
    sessionId,
    relativePath,
  );
  await mkdir(path.dirname(absPath), { recursive: true });
  await writeFile(absPath, buffer);

  return {
    path: relativePath,
    sizeBytes: buffer.byteLength,
    originalName: options.originalName,
  };
}

export async function listWorkspaceFiles(
  sessionId: string,
  subdir = UPLOADS_DIR,
): Promise<WorkspaceFileEntry[]> {
  const absDir = resolveWorkspacePath(
    DEFAULT_WORKSPACE_BASE,
    sessionId,
    subdir,
  );
  try {
    const entries = await readdir(absDir, { withFileTypes: true });
    const files: WorkspaceFileEntry[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const rel = path.posix.join(subdir.replace(/\\/g, "/"), entry.name);
      const abs = resolveWorkspacePath(
        DEFAULT_WORKSPACE_BASE,
        sessionId,
        rel,
      );
      const info = await stat(abs);
      files.push({
        path: rel,
        name: entry.name,
        sizeBytes: info.size,
      });
    }
    return files.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/** Append workspace file hints so the agent can open them with tools. */
export function formatUserMessageWithAttachments(
  message: string,
  attachmentPaths: string[] | undefined,
): string {
  const trimmed = message.trim();
  const paths = (attachmentPaths ?? []).filter(
    (p) => typeof p === "string" && p.trim().length > 0,
  );
  if (paths.length === 0) return trimmed;
  const list = paths.map((p) => p.trim()).join(", ");
  const hint =
    `[User uploaded workspace files (use read_file, read_pdf, inspect_image, or list_directory as needed): ${list}]`;
  return trimmed.length > 0 ? `${trimmed}\n\n${hint}` : hint;
}
