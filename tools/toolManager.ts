import path from "node:path";
import { ToolRegistry } from "../interfaces/registry.js";
import type { Tool } from "../interfaces/types.js";

// Import built-in tools
import { ListDirectoryTool } from "../connectors/filesystem/tools/list-directory.tool.js";
import { ReadFileTool } from "../connectors/filesystem/tools/read-file.tool.js";
import { WriteFileTool } from "../connectors/filesystem/tools/write-file.tool.js";
import { AskUserTool } from "./ask-user.tool.js";
import { SearchMemoryTool } from "./search-memory.tool.js";
import { MemoryManager } from "../core/memory-manager.js";
import { SearchEmailsTool } from "../connectors/gmail/tools/search-emails.tool.js";

export class ToolManager {
  private readonly toolRegistry = new ToolRegistry();

  constructor(
    private readonly memoryManager: MemoryManager,
    private readonly baseDir: string = process.cwd(),
  ) {}

  async loadAllTools(): Promise<ToolRegistry> {
    // Register built-in tools
    // this.toolRegistry.register(new ReadFileTool());
    // this.toolRegistry.register(new WriteFileTool());
    // this.toolRegistry.register(new ListDirectoryTool());
    // this.toolRegistry.register(new AskUserTool());
    // this.toolRegistry.register(new SearchMemoryTool(this.memoryManager));
    // this.toolRegistry.register(new SearchEmailsTool());

    // Load connector tools (search connectors/*/tools/*.tool.js)
    const connectorsDir = path.join(this.baseDir, "connectors");
    let connectorEntries: string[] = [];
    try {
      const { readdir } = await import("node:fs/promises");
      connectorEntries = await readdir(connectorsDir);
    } catch {
      // No connectors directory
    }
    for (const connector of connectorEntries) {
      const toolsDir = path.join(connectorsDir, connector, "tools");
      let toolFiles: string[] = [];
      try {
        const { readdir } = await import("node:fs/promises");
        toolFiles = await readdir(toolsDir);
      } catch {
        continue;
      }
      for (const file of toolFiles) {
        if (file.endsWith(".tool.ts")) {
          try {
            const mod = await import(path.join(toolsDir, file));
            // Register all exported Tool classes
            for (const exported of Object.values(mod)) {
              if (
                typeof exported === "function" &&
                exported.prototype &&
                typeof exported.prototype.run === "function"
              ) {
                const tool: Tool = new (exported as new () => Tool)();
                this.toolRegistry.register(tool);
              }
            }
          } catch {
            // Ignore broken tool files
          }
        }
      }
    }
    return this.toolRegistry;
  }
}
