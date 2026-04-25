import { readdir } from "node:fs/promises";
import type { Tool, ToolContext } from "../../../interfaces/types.js";

export class ListDirectoryTool implements Tool {
  name = "list_directory";
  description = "List files and folders in a directory path.";

  async run(input: Record<string, unknown>, _context: ToolContext): Promise<unknown> {
    const path = input.path;
    if (typeof path !== "string" || path.length === 0) {
      throw new Error("list_directory requires { path: string }.");
    }
    const entries = await readdir(path, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? "directory" : "file"
    }));
  }
}
