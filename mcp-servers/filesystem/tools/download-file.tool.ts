import { z } from "zod";
import type { Tool, ToolContext } from "../../../common/interfaces/types.js";
import {
  allowedContentTypesForProfile,
  downloadFromUrl,
  inferFileExtension,
  writeDownloadToWorkspace,
} from "../../../common/services/file-download.js";
import { logger } from "../../../common/services/logger.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../../common/services/zod-tool-schema.js";

export const downloadFileInputSchema = z.object({
  url: z.string().url().describe("HTTP or HTTPS URL of the file to download."),
  outputPath: z
    .string()
    .min(1)
    .describe(
      "Workspace-relative output path (e.g. assets/report.pdf). Extension optional; inferred from response when missing.",
    ),
  profile: z
    .enum(["default", "image"])
    .optional()
    .describe(
      "Content-type allowlist: default (images, pdf, json, csv, txt, fonts) or image-only.",
    ),
});

export type DownloadFileInput = z.infer<typeof downloadFileInputSchema>;

export class DownloadFileTool implements Tool {
  name = "download_file";
  description =
    "Download a file from an HTTPS URL into the session workspace. Supports images, PDF, JSON, CSV, plain text, and common font types (default profile), or images only when profile is image.";
  inputSchema = zodSchemaToJsonInputSchema(downloadFileInputSchema);

  async run(input: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const parsed = parseToolInput(this.name, downloadFileInputSchema, input);
    const profile = parsed.profile ?? "default";
    const allowed = allowedContentTypesForProfile(profile);

    try {
      logger.info(`Downloading file → ${parsed.outputPath}`);
      const { buffer, contentType, sizeBytes } = await downloadFromUrl({
        url: parsed.url,
        allowedContentTypes: allowed,
        acceptHeader: profile === "image" ? "image/*" : "*/*",
        resourceLabel: "File",
      });

      const fallbackExt = profile === "image" ? ".jpg" : ".bin";
      const ext = inferFileExtension(contentType, parsed.url, fallbackExt);
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
        profile,
        message: "File downloaded to workspace.",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`download_file failed: ${message}`);
      throw new Error(`download_file failed: ${message}`);
    }
  }
}
