import path from "node:path";
import { ToolRegistry } from "../common/interfaces/registry.js";
import type { Tool } from "../common/interfaces/types.js";
import { MemoryManager } from "./memory-manager.js";
import { logger } from "../common/services/logger.js";

export class ToolManager {
  private readonly toolRegistry = new ToolRegistry();

  constructor(
    private readonly memoryManager: MemoryManager,
    private readonly baseDir: string = process.cwd(),
  ) {}

  async loadAllTools(): Promise<ToolRegistry> {
    await this.loadToolsFromDirectory(path.join(this.baseDir, "runtime", "tools"));
    return this.toolRegistry;
  }

  private async loadToolsFromDirectory(toolsDir: string): Promise<void> {
    const { readdir } = await import("node:fs/promises");
    let toolFiles: string[] = [];
    try {
      toolFiles = await readdir(toolsDir);
    } catch {
      return;
    }

    for (const file of toolFiles) {
      if (!file.endsWith(".tool.ts") && !file.endsWith(".tool.js")) continue;
      try {
        const mod = await import(path.join(toolsDir, file));
        for (const exported of Object.values(mod)) {
          if (
            typeof exported === "function" &&
            exported.prototype &&
            typeof exported.prototype.run === "function"
          ) {
            const maybeTool = new (
              exported as new (...args: unknown[]) => Tool
            )(this.memoryManager);
            if (typeof maybeTool.name === "string") {
              this.toolRegistry.register(maybeTool);
              logger.debug(`Tool ${maybeTool.name} loaded`);
            }
          }
        }
      } catch {
        // Ignore broken tool files
      }
    }
  }
}
