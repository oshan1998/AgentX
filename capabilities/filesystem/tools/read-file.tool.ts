import { readFile } from "node:fs/promises";
import type { Tool, ToolContext } from "../../../interfaces/types.js";

export class ReadFileTool implements Tool {
  name = "read_file";
  description = "Read text content from a file path.";

  async run(input: Record<string, unknown>, _context: ToolContext): Promise<unknown> {
    const path = input.path;
    if (typeof path !== "string" || path.length === 0) {
      throw new Error("read_file requires { path: string }.");
    }
    return readFile(path, "utf-8");
  }
}
