import type { ImageGenInput, ImageGenResult } from "../interfaces/types.js";
import {
  createImageGenAdapter,
  isImageGenProviderSupported,
  resolveImageGenProvider,
} from "../../llm-adapters/factory.js";

export type GenerateImageOptions = ImageGenInput;
export type GeneratedImageResult = ImageGenResult;

/**
 * Generates an image from a text prompt using the configured image-gen provider.
 */
export async function generateImage(options: GenerateImageOptions): Promise<GeneratedImageResult> {
  const provider = resolveImageGenProvider();

  if (!isImageGenProviderSupported(provider)) {
    throw new Error(
      `Image generation provider "${provider}" is not supported. Use IMAGE_GEN_PROVIDER=vertex with GCP credentials.`,
    );
  }

  const adapter = createImageGenAdapter(provider);
  return adapter.generateImage(options);
}
