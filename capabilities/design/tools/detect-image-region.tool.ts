import { z } from "zod";
import type { Tool, ToolContext } from "../../../common/interfaces/types.js";
import { analyzeImage } from "../../../common/services/vision-analyze.js";
import { logger } from "../../../common/services/logger.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../../common/services/zod-tool-schema.js";
import {
  DEFAULT_WORKSPACE_BASE,
  resolveWorkspacePath,
} from "../../../common/services/workspace-path.js";
import sharp from "sharp";

export const detectImageRegionInputSchema = z.object({
  path: z.string().min(1).describe("Workspace-relative image path to analyze."),
  prompt: z
    .string()
    .min(1)
    .describe(
      'What object or area to find (e.g. "Find the dog\'s face", "Find the submit button").',
    ),
});

export type DetectImageRegionInput = z.infer<typeof detectImageRegionInputSchema>;

export class DetectImageRegionTool implements Tool {
  name = "detect_image_region";
  description =
    "Find the exact pixel coordinates (left, top, width, height) of a specific object or region in an image. Returns coordinates ready to be used in crop operations.";
  inputSchema = zodSchemaToJsonInputSchema(detectImageRegionInputSchema);

  async run(input: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const parsed = parseToolInput(this.name, detectImageRegionInputSchema, input);
    const absPath = resolveWorkspacePath(
      DEFAULT_WORKSPACE_BASE,
      context.sessionId,
      parsed.path,
    );

    try {
      logger.info(`Detecting region in image: ${parsed.path} for query: "${parsed.prompt}"`);
      const meta = await sharp(absPath).metadata();
      const width = meta.width ?? 0;
      const height = meta.height ?? 0;

      if (width === 0 || height === 0) {
        throw new Error("Could not determine image dimensions.");
      }

      const visionPrompt = `You are a precise vision model. The user wants to find the bounding box for the following query: "${parsed.prompt}".
You must respond with ONLY a valid JSON object (no markdown formatting, no code blocks, no other text) with the following structure containing percentages (0 to 100) of the image dimensions:
{
  "top_percent": number,
  "left_percent": number,
  "width_percent": number,
  "height_percent": number
}
Ensure the bounding box tightly surrounds the requested object.`;

      const vision = await analyzeImage({ imagePath: absPath, prompt: visionPrompt });
      
      if (vision.fallback) {
          throw new Error("Vision AI is unavailable. Cannot detect regions without vision.");
      }

      // Try to parse JSON from the response
      const match = vision.description.match(/\{[\s\S]*?\}/);
      let jsonStr = match ? match[0] : vision.description.trim();
      
      // Attempt to clean markdown if present
      jsonStr = jsonStr.replace(/^```(json)?/, "").replace(/```$/, "").trim();

      let result: any;
      try {
        result = JSON.parse(jsonStr);
      } catch (parseError) {
        throw new Error(`Failed to parse JSON from vision response: ${vision.description}`);
      }

      if (
        typeof result.top_percent !== "number" ||
        typeof result.left_percent !== "number" ||
        typeof result.width_percent !== "number" ||
        typeof result.height_percent !== "number"
      ) {
        throw new Error(`Invalid JSON structure returned by vision model: ${jsonStr}`);
      }

      const left = Math.round((result.left_percent / 100) * width);
      const top = Math.round((result.top_percent / 100) * height);
      const regionWidth = Math.round((result.width_percent / 100) * width);
      const regionHeight = Math.round((result.height_percent / 100) * height);

      return {
        path: parsed.path,
        query: parsed.prompt,
        image_dimensions: { width, height },
        region_percentages: result,
        crop_coordinates: {
          left: Math.max(0, left),
          top: Math.max(0, top),
          width: Math.min(width - left, regionWidth),
          height: Math.min(height - top, regionHeight),
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`detect_image_region failed: ${message}`);
      throw new Error(`detect_image_region failed: ${message}`);
    }
  }
}
