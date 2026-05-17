import path from "node:path";

/** Matches `main.ts` memory root (`process.cwd()/memory`). */
export const DEFAULT_MEMORY_BASE = path.join(process.cwd(), "memory");

/** Principal session id for delegated runs (`root::sub_*` → `root`). */
export function resolveRootSessionId(sessionId: string): string {
  return sessionId.split("::")[0];
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
