import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import type { ForegroundMaskResult, RemoveBackgroundInput } from "../interfaces/types.js";
import { resolveVertexLocation, resolveVertexProject } from "../../llm-adapters/vertex-config.js";
import {
  buildMaskFromForegroundShape,
  type ForegroundShape,
  type NormalizedPolygon,
} from "./image-mask.js";
import { logger } from "./logger.js";

const SEGMENTATION_PROMPT = `Trace the silhouette of the main foreground subject in this image (the primary object, not the background).

Return ONLY a JSON object, no markdown:
{
  "polygons": [[[x, y], [x, y], ...]],
  "box_2d": [y0, x0, y1, x1],
  "label": "short description of the subject"
}

Rules:
- "polygons" is an array of closed polygons that together cover the subject. Use one polygon for a single connected subject; add more polygons only for clearly separate parts.
- Each polygon is an ordered list of [x, y] vertices tracing the outline, 24-64 points, following the subject's contour as closely as possible.
- All coordinates are integers normalized 0-1000 (x = left→right, y = top→bottom).
- "box_2d" is the subject's bounding box, also normalized 0-1000.
- Do NOT output image data, base64, or any binary.`;

/** Longest edge (px) of the image sent to the model; keeps the request small/fast without affecting mask resolution. */
const MODEL_INPUT_MAX_EDGE = 1024;

function resolveGeminiSegmentationModel(): string {
  return (
    process.env.GEMINI_SEGMENTATION_MODEL?.trim() ||
    process.env.GEMINI_VISION_MODEL?.trim() ||
    process.env.GEMINI_MODEL?.trim() ||
    "gemini-2.5-flash"
  );
}

function extractJsonObject(text: string): unknown {
  let jsonStr = text.trim();

  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1]!.trim();
  }

  if (!jsonStr.startsWith("{") && !jsonStr.startsWith("[")) {
    const objStart = jsonStr.indexOf("{");
    const arrStart = jsonStr.indexOf("[");
    const start =
      objStart < 0 ? arrStart : arrStart < 0 ? objStart : Math.min(objStart, arrStart);
    const objEnd = jsonStr.lastIndexOf("}");
    const arrEnd = jsonStr.lastIndexOf("]");
    const end = Math.max(objEnd, arrEnd);
    if (start >= 0 && end > start) {
      jsonStr = jsonStr.slice(start, end + 1);
    }
  }

  return JSON.parse(jsonStr);
}

function isPoint(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  );
}

function normalizePolygon(value: unknown): NormalizedPolygon | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const points = value.filter(isPoint).map(([x, y]) => [x, y] as [number, number]);
  return points.length >= 3 ? points : null;
}

function parseForegroundShape(parsed: unknown): ForegroundShape {
  const polygons: NormalizedPolygon[] = [];
  let box: ForegroundShape["box"];

  const root = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!root || typeof root !== "object") {
    throw new Error("Gemini segmentation returned an unexpected response shape.");
  }

  const record = root as Record<string, unknown>;

  if (Array.isArray(record.polygons)) {
    for (const candidate of record.polygons) {
      const polygon = normalizePolygon(candidate);
      if (polygon) {
        polygons.push(polygon);
      }
    }
  }

  // Tolerate a single "polygon" key in addition to "polygons".
  if (polygons.length === 0) {
    const single = normalizePolygon(record.polygon);
    if (single) {
      polygons.push(single);
    }
  }

  if (
    Array.isArray(record.box_2d) &&
    record.box_2d.length === 4 &&
    record.box_2d.every((n) => typeof n === "number")
  ) {
    box = record.box_2d as [number, number, number, number];
  }

  if (polygons.length === 0 && !box) {
    throw new Error("Gemini segmentation returned no usable polygon or bounding box.");
  }

  return { polygons, box };
}

/**
 * Segments the main foreground subject using Gemini vision when Vertex segmentImage is unavailable.
 *
 * The model returns the subject silhouette as polygon vertices (plain numbers), which we
 * rasterize into a mask locally. This avoids asking the model to emit base64 PNG bytes,
 * which it cannot produce reliably (truncated / CRC-invalid output).
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

  // Send a downscaled copy: coordinates are normalized, so mask resolution is unaffected.
  const modelImage = await sharp(input.sourceImage)
    .resize(MODEL_INPUT_MAX_EDGE, MODEL_INPUT_MAX_EDGE, { fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();

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
              mimeType: "image/png",
              data: modelImage.toString("base64"),
            },
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      maxOutputTokens: 8192,
      // Disable "thinking" so the structured polygon output is returned quickly and intact.
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const text = response.text;
  if (!text?.trim()) {
    throw new Error("Gemini segmentation returned empty response.");
  }

  const shape = parseForegroundShape(extractJsonObject(text));
  const foregroundMaskBuffer = await buildMaskFromForegroundShape(shape, width, height);

  return {
    foregroundMaskBuffer,
    provider: "vertex",
    model: `${model} (gemini-segmentation-fallback)`,
  };
}
