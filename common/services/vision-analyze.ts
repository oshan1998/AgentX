import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { LlmImageInput } from "../interfaces/types.js";
import {
  createVisionLlmAdapter,
  isVisionProviderSupported,
  resolveVisionProvider,
} from "../../llm-adapters/factory.js";

export interface VisionAnalyzeOptions {
  imagePath: string;
  prompt: string;
}

export interface VisionAnalyzeResult {
  description: string;
  provider: string;
}

function mimeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

async function loadImageInput(absPath: string): Promise<LlmImageInput> {
  const buffer = await readFile(absPath);
  return {
    mimeType: mimeForPath(absPath),
    dataBase64: buffer.toString("base64"),
  };
}

async function metadataFallback(
  absPath: string,
  message: string,
): Promise<VisionAnalyzeResult & { fallback: true }> {
  const meta = await sharp(absPath).metadata();
  return {
    description: `${message} Image metadata: ${meta.width ?? "?"}×${meta.height ?? "?"} ${meta.format ?? "unknown"}.`,
    provider: "metadata_fallback",
    fallback: true,
  };
}

/**
 * Describes an image using the configured vision provider, with metadata fallback.
 */
export async function analyzeImage(
  options: VisionAnalyzeOptions,
): Promise<VisionAnalyzeResult & { fallback?: boolean }> {
  const { imagePath, prompt } = options;
  const absPath = path.resolve(imagePath);
  const provider = resolveVisionProvider();

  if (!isVisionProviderSupported(provider)) {
    return metadataFallback(
      absPath,
      `Vision not configured (VISION_PROVIDER=${provider}).`,
    );
  }

  try {
    const llm = createVisionLlmAdapter(provider);
    const image = await loadImageInput(absPath);
    const description = await llm.completeWithImage(prompt, image);
    return { description, provider };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const fallback = await metadataFallback(
      absPath,
      `Vision unavailable (${message}).`,
    );
    return {
      ...fallback,
      description: `${fallback.description} Re-run with VISION_PROVIDER=openai or gemini and API credentials.`,
    };
  }
}
