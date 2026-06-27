import { readFile } from "node:fs/promises";
import path from "node:path";
import { ToolRegistry } from "../common/interfaces/registry.js";
import type { Tool } from "../common/interfaces/types.js";
import { logger } from "../common/services/logger.js";
import { MemoryManager } from "./memory-manager.js";
import { McpClientManager, type McpServerConfig } from "./mcp-client-manager.js";

interface McpConfig {
  servers: McpServerConfig[];
}

export class ToolManager {
  private readonly toolRegistry = new ToolRegistry();
  readonly mcpClientManager = new McpClientManager();

  constructor(
    private readonly memoryManager: MemoryManager,
    private readonly baseDir: string = process.cwd(),
  ) {}

  async loadAllTools(): Promise<ToolRegistry> {
    await this.loadCoreTools();
    await this.loadMcpTools();
    return this.toolRegistry;
  }

  async shutdown(): Promise<void> {
    await this.mcpClientManager.shutdown();
  }

  private async loadCoreTools(): Promise<void> {
    const coreToolsDir = path.join(this.baseDir, "core-tools");
    const { readdir } = await import("node:fs/promises");
    let toolFiles: string[] = [];
    try {
      toolFiles = await readdir(coreToolsDir);
    } catch {
      return;
    }

    for (const file of toolFiles) {
      if (file.endsWith(".tool.ts") || file.endsWith(".tool.js")) {
        try {
          const mod = await import(path.join(coreToolsDir, file));
          for (const exported of Object.values(mod)) {
            if (
              typeof exported === "function" &&
              exported.prototype &&
              typeof exported.prototype.run === "function"
            ) {
              const maybeTool = new (exported as new (...args: unknown[]) => Tool)(
                this.memoryManager,
              );
              if (typeof maybeTool.name === "string") {
                this.toolRegistry.register(maybeTool);
                logger.debug(`Core tool ${maybeTool.name} loaded`);
              }
            }
          }
        } catch {
          // ignore broken files
        }
      }
    }
  }

  private async loadMcpTools(): Promise<void> {
    const configPath = path.join(this.baseDir, "mcp.config.json");
    let config: McpConfig;
    try {
      const raw = await readFile(configPath, "utf-8");
      config = JSON.parse(raw) as McpConfig;
    } catch {
      logger.debug("No mcp.config.json found; skipping MCP tool loading");
      return;
    }

    await this.mcpClientManager.loadInto(this.toolRegistry, config.servers ?? []);
  }
}
