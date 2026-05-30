import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import type { ForegroundMaskResult, RemoveBackgroundInput } from "../interfaces/types.js";
import { resolveVertexLocation, resolveVertexProject } from "../../llm-adapters/vertex-config.js";
import {
  buildFullMaskFromGeminiSegment,
  type GeminiSegmentMaskEntry,
} from "./image-mask.js";
import { logger } from "./logger.js";

const SEGMENTATION_PROMPT = `Identify the main foreground subject in this image (the primary object, not the background).
Output a JSON array with exactly one entry. Each entry must have:
- "box_2d": [y0, x0, y1, x1] bounding box with coordinates normalized 0-1000
- "mask": base64-encoded PNG of the segmentation mask within the bounding box (white=subject, black=background)
- "label": short description of the subject

Return ONLY valid JSON, no markdown.`;

function resolveGeminiSegmentationModel(): string {
  return (
    process.env.GEMINI_SEGMENTATION_MODEL?.trim() ||
    process.env.GEMINI_VISION_MODEL?.trim() ||
    process.env.GEMINI_MODEL?.trim() ||
    "gemini-2.5-flash"
  );
}

function parseSegmentationJson(text: string): GeminiSegmentMaskEntry[] {
  let jsonStr = text.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1]!.trim();
  } else if (!jsonStr.startsWith("[")) {
    const arrStart = jsonStr.indexOf("[");
    const arrEnd = jsonStr.lastIndexOf("]");
    if (arrStart >= 0 && arrEnd > arrStart) {
      jsonStr = jsonStr.slice(arrStart, arrEnd + 1);
    }
  }

  const parsed = JSON.parse(jsonStr) as unknown;
  if (Array.isArray(parsed)) {
    return parsed as GeminiSegmentMaskEntry[];
  }
  if (parsed && typeof parsed === "object" && "masks" in parsed) {
    return (parsed as { masks: GeminiSegmentMaskEntry[] }).masks;
  }

  throw new Error("Unexpected Gemini segmentation response format.");
}

/**
 * Segments the main foreground subject using Gemini vision when Vertex segmentImage is unavailable.
 */
export async function segmentForegroundWithGemini(
  input: RemoveBackgroundInput,
): Promise<ForegroundMaskResult> {
  const model = resolveGeminiSegmentationModel();
  const client = new GoogleGenAI({
    vertexai: true,
    project: resolveVertexProject(),
    location: resolveVertexLocation(),
  });

  const sourceMeta = await sharp(input.sourceImage).metadata();
  const width = sourceMeta.width;
  const height = sourceMeta.height;
  if (!width || !height) {
    throw new Error("Source image dimensions could not be determined.");
  }

  logger.info(`Segmenting foreground via Gemini (${model})`);

  const response = await client.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [
          { text: SEGMENTATION_PROMPT },
          {
            inlineData: {
              mimeType: input.sourceMimeType,
              data: input.sourceImage.toString("base64"),
            },
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
    },
  });

  const text = response.text;
  if (!text?.trim()) {
    throw new Error("Gemini segmentation returned empty response.");
  }

  const entries = parseSegmentationJson(text);
  const entry = entries[0];
  if (!entry?.box_2d || !entry?.mask) {
    throw new Error("Gemini segmentation returned no usable mask entry.");
  }

  const foregroundMaskBuffer = await buildFullMaskFromGeminiSegment(entry, width, height);

  return {
    foregroundMaskBuffer,
    provider: "vertex",
    model: `${model} (gemini-segmentation-fallback)`,
  };
}
