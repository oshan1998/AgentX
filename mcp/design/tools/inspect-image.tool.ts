import { z } from "zod";
import type { Tool, ToolContext } from "../../../common/interfaces/types.js";
import { analyzeImage } from "../services/vision-analyze.js";
import { logger } from "../../_shared/logger.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../_shared/zod-tool-schema.js";
import {
  DEFAULT_WORKSPACE_BASE,
  resolveWorkspacePath,
} from "../../_shared/workspace-path.js";
import { stat } from "node:fs/promises";
import sharp from "sharp";

export const inspectImageInputSchema = z.object({
  path: z.string().min(1).describe("Workspace-relative image path to analyze."),
  prompt: z
    .string()
    .optional()
    .describe(
      'What to analyze (e.g. "Describe composition and suggest crop improvements"). Default describes content and design quality.',
    ),
});

export type InspectImageInput = z.infer<typeof inspectImageInputSchema>;

const DEFAULT_PROMPT =
  "Describe this image for a graphic designer: subject, composition, colors, text legibility, and 2–3 concrete improvement suggestions for social-media use.";

export class InspectImageTool implements Tool {
  name = "inspect_image";
  description =
    "Analyse a workspace image with vision AI and return design feedback (composition, subjects, text, colour). Falls back to metadata when vision is unavailable.";
  inputSchema = zodSchemaToJsonInputSchema(inspectImageInputSchema);

  async run(input: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const parsed = parseToolInput(this.name, inspectImageInputSchema, input);
    const absPath = resolveWorkspacePath(
      DEFAULT_WORKSPACE_BASE,
      context.sessionId,
      parsed.path,
    );
    const prompt = parsed.prompt ?? DEFAULT_PROMPT;

    try {
      logger.info(`Inspecting image: ${parsed.path}`);
      const fileInfo = await stat(absPath);
      const meta = await sharp(absPath).metadata();

      const vision = await analyzeImage({ imagePath: absPath, prompt });

      return {
        path: parsed.path,
        width: meta.width ?? null,
        height: meta.height ?? null,
        format: meta.format ?? null,
        sizeBytes: fileInfo.size,
        analysis: vision.description,
        visionProvider: vision.provider,
        fallback: vision.fallback ?? false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`inspect_image failed: ${message}`);
      throw new Error(`inspect_image failed: ${message}`);
    }
  }
}
