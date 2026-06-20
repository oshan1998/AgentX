import path from "node:path";
import { readdir } from "node:fs/promises";
import type { Tool } from "../common/interfaces/types.js";
import { logger } from "../common/services/logger.js";

/**
 * Discovers and instantiates `*.tool.{ts,js}` classes from a capability/
 * integration directory's `tools/` folder. Mirrors the discovery used by the
 * in-app ToolManager, but constructs tools with no args (extracted tools are
 * self-contained and do not depend on in-process managers).
 */
export async function loadCapabilityTools(toolsDir: string): Promise<Tool[]> {
  const tools: Tool[] = [];
  let files: string[] = [];
  try {
    files = await readdir(toolsDir);
  } catch {
    logger.warn(`[mcp-server] No tools directory at ${toolsDir}.`);
    return tools;
  }

  for (const file of files) {
    if (!file.endsWith(".tool.ts") && !file.endsWith(".tool.js")) continue;
    try {
      const mod = await import(path.join(toolsDir, file));
      for (const exported of Object.values(mod)) {
        if (
          typeof exported === "function" &&
          exported.prototype &&
          typeof exported.prototype.run === "function"
        ) {
          const instance = new (exported as new () => Tool)();
          if (typeof instance.name === "string") {
            tools.push(instance);
          }
        }
      }
    } catch (e) {
      logger.error(`[mcp-server] Failed to load tool file ${file}.`, {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return tools;
}
