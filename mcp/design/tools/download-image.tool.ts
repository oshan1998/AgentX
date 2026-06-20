import { z } from "zod";
import type { Tool, ToolContext } from "../../../common/interfaces/types.js";
import {
  downloadImageFromUrl,
  inferImageExtension,
} from "../services/image-download.js";
import { writeDownloadToWorkspace } from "../../_shared/file-download.js";
import { logger } from "../../_shared/logger.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../_shared/zod-tool-schema.js";

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
      const outputPath = await writeDownloadToWorkspace(
        context.sessionId,
        parsed.outputPath,
        buffer,
        ext,
      );

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
