import sharp from "sharp";
import type { RemoveBackgroundInput, RemoveBackgroundResult } from "../interfaces/types.js";
import {
  createImageGenAdapter,
  isImageGenProviderSupported,
  resolveImageGenProvider,
} from "../../llm-adapters/factory.js";
import { applyMaskAsAlpha, invertMask, normalizeMask } from "./image-mask.js";

const DEFAULT_MASK_BLUR_SIGMA = 0.5;

function resolveMaskBlurSigma(override?: number): number {
  if (override !== undefined) {
    return override;
  }
  const value = Number(process.env.IMAGEN_SEGMENTATION_MASK_BLUR);
  return Number.isFinite(value) ? value : DEFAULT_MASK_BLUR_SIGMA;
}

/**
 * Remove an image's background using Vertex AI segmentImage, returning a transparent PNG
 * plus matching foreground/background masks at the source resolution.
 */
export async function removeBackground(
  input: RemoveBackgroundInput,
): Promise<RemoveBackgroundResult> {
  const provider = resolveImageGenProvider();
  if (!isImageGenProviderSupported(provider)) {
    throw new Error(
      `Image generation provider "${provider}" is not supported. Use IMAGE_GEN_PROVIDER=vertex with GCP credentials.`,
    );
  }

  const sourceImage = await sharp(input.sourceImage).png().toBuffer();
  const { width, height } = await sharp(sourceImage).metadata();
  if (!width || !height) {
    throw new Error("Source image dimensions could not be determined.");
  }

  const segmentation = await createImageGenAdapter(provider).removeBackground({
    ...input,
    sourceImage,
    sourceMimeType: "image/png",
  });

  const foregroundMaskBuffer = await normalizeMask(
    segmentation.foregroundMaskBuffer,
    width,
    height,
    resolveMaskBlurSigma(input.maskBlurSigma),
  );

  return {
    transparentBuffer: await applyMaskAsAlpha(sourceImage, foregroundMaskBuffer),
    foregroundMaskBuffer,
    backgroundMaskBuffer: await invertMask(foregroundMaskBuffer),
    provider: segmentation.provider,
    model: segmentation.model,
  };
}
