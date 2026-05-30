import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Tool, ToolContext } from "../../../common/interfaces/types.js";
import {
  downloadImageFromUrl,
  inferImageExtension,
} from "../../../common/services/image-download.js";
import { logger } from "../../../common/services/logger.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../../common/services/zod-tool-schema.js";
import {
  DEFAULT_WORKSPACE_BASE,
  resolveWorkspacePath,
} from "../../../common/services/workspace-path.js";

export const downloadImageInputSchema = z.object({
  url: z.string().url().describe("HTTPS URL of the image to download."),
  outputPath: z
    .string()
    .min(1)
    .describe(
      "Workspace-relative output path (e.g. assets/hero.jpg). Extension optional; inferred from response when missing.",
    ),
});

export type DownloadImageInput = z.infer<typeof downloadImageInputSchema>;

function ensureExtension(outputPath: string, ext: string): string {
  const current = path.extname(outputPath).toLowerCase();
  if (current.length) return outputPath;
  return outputPath + ext;
}

export class DownloadImageTool implements Tool {
  name = "download_image";
  description =
    "Download an image from an HTTPS URL and save it to the session workspace for use in designs.";
  inputSchema = zodSchemaToJsonInputSchema(downloadImageInputSchema);

  async run(input: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const parsed = parseToolInput(this.name, downloadImageInputSchema, input);

    try {
      logger.info(`Downloading image → ${parsed.outputPath}`);
      const { buffer, contentType, sizeBytes } = await downloadImageFromUrl({
        url: parsed.url,
      });

      const ext = inferImageExtension(contentType, parsed.url);
      const outputPath = ensureExtension(parsed.outputPath, ext);
      const absOutput = resolveWorkspacePath(
        DEFAULT_WORKSPACE_BASE,
        context.sessionId,
        outputPath,
      );
      await mkdir(path.dirname(absOutput), { recursive: true });
      await writeFile(absOutput, buffer);

      return {
        success: true,
        outputPath,
        url: parsed.url,
        contentType,
        sizeBytes,
        message: "Image downloaded to workspace.",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`download_image failed: ${message}`);
      throw new Error(`download_image failed: ${message}`);
    }
  }
}
