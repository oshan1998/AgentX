import { readdir } from "node:fs/promises";
import type { Tool, ToolContext } from "../../../common/interfaces/types.js";

export class ListDirectoryTool implements Tool {
  name = "list_directory";
  description = "List files and folders in a directory path.";
  inputSchema = {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Directory path to list.",
      },
    },
    required: ["path"],
  } as const;

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
