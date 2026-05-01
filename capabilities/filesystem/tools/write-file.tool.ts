import { writeFile } from "node:fs/promises";
import type { Tool, ToolContext } from "../../../common/interfaces/types.js";

export class WriteFileTool implements Tool {
  name = "write_file";
  description = "Write text content into a file path.";
  inputSchema = {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Destination path under workspace/",
      },
      content: {
        type: "string",
        description: "Full file contents as UTF-8 text.",
      },
    },
    required: ["path", "content"],
  } as const;

  async run(input: Record<string, unknown>, _context: ToolContext): Promise<unknown> {
    const path = input.path;
    const content = input.content;
    if (typeof path !== "string" || path.length === 0 || typeof content !== "string") {
      throw new Error("write_file requires { path: string, content: string }.");
    }
    await writeFile(path, content, "utf-8");
    return { success: true, path };
  }
}
