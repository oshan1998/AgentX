import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

/** Matches `main.ts` memory root (`process.cwd()/memory`). */
export const DEFAULT_WORKSPACE_BASE = path.join(process.cwd(), "workspace");

/** Principal session id for delegated runs (`root::sub_*` → `root`). */
export function resolveRootSessionId(sessionId: string): string {
  return sessionId.split("::")[0];
}

/** Model/plan-facing path without a leading `workspace/` prefix (e.g. `tasks/foo.md`). */
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
 * Map a model-facing path (`tasks/foo.md` or `workspace/tasks/foo.md`) to an absolute
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

/** True when the resolved path exists as a non-empty file in the session workspace. */
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
