import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

/**
 * Workspace base directory. Defaults to `process.cwd()/workspace` (matches the
 * main app). An extracted MCP server can override it with AGENTX_WORKSPACE_BASE
 * to point at the same shared workspace when running as a separate process.
 */
export const DEFAULT_WORKSPACE_BASE = process.env.AGENTX_WORKSPACE_BASE?.trim()
  ? path.resolve(process.env.AGENTX_WORKSPACE_BASE.trim())
  : path.join(process.cwd(), "workspace");

/** Principal session id for delegated runs (`root::sub_*` → `root`). */
export function resolveRootSessionId(sessionId: string): string {
  return sessionId.split("::")[0];
}

/** Zod / tool copy: task-plan `artifact_path` is any workspace file, not markdown-only. */
export const ARTIFACT_PATH_FIELD_DESCRIPTION =
  "Relative path in this session workspace for this step's primary output file (any extension: .md, .json, .csv, .txt, .pdf, .png, .svg, etc.). Use the same path when reading or writing in later steps.";

/** Model/plan-facing path without a leading `workspace/` prefix (e.g. `tasks/report.pdf`). */
export function normalizeWorkspaceRelativePath(userPath: string): string {
  return userPath.replace(/^workspace\/?/i, "").replace(/^\/+/, "");
}

/** Absolute directory for session-scoped artifacts: `memory/sessions/<root>/workspace`. */
export function getSessionWorkspaceRoot(
  memoryBase: string,
  sessionId: string,
): string {
  const rootId = resolveRootSessionId(sessionId);
  return path.join(memoryBase, "sessions", rootId, "workspace");
}

/**
 * Map a model-facing path (`tasks/foo.json` or `workspace/tasks/foo.json`) to an absolute
 * path under the session workspace. Rejects path traversal outside that root.
 */
export function resolveWorkspacePath(
  memoryBase: string,
  sessionId: string,
  userPath: string,
): string {
  const root = path.resolve(getSessionWorkspaceRoot(memoryBase, sessionId));
  const rel = userPath.replace(/^workspace\/?/i, "").replace(/^\/+/, "");
  if (!rel.length) {
    return root;
  }
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error("Path escapes session workspace");
  }
  return abs;
}

/** True when the resolved path exists as a non-empty file in the session workspace (any type). */
export async function sessionArtifactExists(
  memoryBase: string,
  sessionId: string,
  artifactPath: string,
): Promise<boolean> {
  try {
    const abs = resolveWorkspacePath(memoryBase, sessionId, artifactPath);
    await access(abs, constants.F_OK);
    const info = await stat(abs);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}
