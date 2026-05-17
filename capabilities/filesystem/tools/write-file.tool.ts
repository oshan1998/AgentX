import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Tool, ToolContext } from "../../../common/interfaces/types.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../../common/services/zod-tool-schema.js";

export const writeFileInputSchema = z.object({
  path: z.string().min(1).describe("Destination path under workspace/"),
  content: z.string().describe("Full file contents as UTF-8 text."),
});

export type WriteFileInput = z.infer<typeof writeFileInputSchema>;

export class WriteFileTool implements Tool {
  name = "write_file";
  description =
    "Write text content into a file path. Creates parent directories (e.g. workspace/tasks/) if they do not exist.";
  inputSchema = zodSchemaToJsonInputSchema(writeFileInputSchema);

  async run(input: Record<string, unknown>, _context: ToolContext): Promise<unknown> {
    const { path: filePath, content } = parseToolInput(this.name, writeFileInputSchema, input);
    const dir = path.dirname(filePath);
    if (dir !== "." && dir.length > 0) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(filePath, content, "utf-8");
    return { success: true, path: filePath };
  }
}
