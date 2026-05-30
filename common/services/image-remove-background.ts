import type {
  ForegroundMaskResult,
  RemoveBackgroundInput,
  RemoveBackgroundResult,
} from "../interfaces/types.js";
import {
  createImageGenAdapter,
  isImageGenProviderSupported,
  resolveImageGenProvider,
} from "../../llm-adapters/factory.js";
import { segmentForegroundWithGemini } from "./gemini-foreground-segmentation.js";
import {
  applyForegroundMaskAsAlpha,
  invertMaskPng,
  normalizeMaskPng,
} from "./image-mask.js";
import { logger } from "./logger.js";
import sharp from "sharp";

export type RemoveBackgroundOptions = RemoveBackgroundInput;

function isSegmentationUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unavailable|NOT_FOUND|"code":404/i.test(message);
}

async function resolveForegroundMask(
  options: RemoveBackgroundOptions,
): Promise<ForegroundMaskResult> {
  const adapter = createImageGenAdapter(resolveImageGenProvider());

  try {
    return await adapter.removeBackground(options);
  } catch (error) {
    if (!isSegmentationUnavailable(error)) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    logger.warn(
      `Vertex segmentImage unavailable (${message}); falling back to Gemini segmentation`,
    );
    return segmentForegroundWithGemini(options);
  }
}

/**
 * Removes the image background using Vertex AI segmentation (with Gemini fallback),
 * returning a transparent PNG and optional foreground/background masks derived from the result.
 */
export async function removeBackground(
  options: RemoveBackgroundOptions,
): Promise<RemoveBackgroundResult> {
  const provider = resolveImageGenProvider();

  if (!isImageGenProviderSupported(provider)) {
    throw new Error(
      `Image generation provider "${provider}" is not supported. Use IMAGE_GEN_PROVIDER=vertex with GCP credentials.`,
    );
  }

  const segmentation = await resolveForegroundMask(options);

  const sourceMeta = await sharp(options.sourceImage).metadata();
  const width = sourceMeta.width;
  const height = sourceMeta.height;

  if (!width || !height) {
    throw new Error("Source image dimensions could not be determined.");
  }

  const foregroundMaskBuffer = await normalizeMaskPng(
    segmentation.foregroundMaskBuffer,
    width,
    height,
  );
  const transparentBuffer = await applyForegroundMaskAsAlpha(
    options.sourceImage,
    foregroundMaskBuffer,
  );
  const backgroundMaskBuffer = await invertMaskPng(foregroundMaskBuffer);

  return {
    transparentBuffer,
    foregroundMaskBuffer,
    backgroundMaskBuffer,
    provider: segmentation.provider,
    model: segmentation.model,
  };
}
