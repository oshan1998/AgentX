import type { ImageEditInput, ImageGenResult } from "../interfaces/types.js";
import {
  createImageGenAdapter,
  isImageGenProviderSupported,
  resolveImageGenProvider,
} from "../../llm-adapters/factory.js";

export type EditImageOptions = ImageEditInput;
export type EditedImageResult = ImageGenResult;

/**
 * Edits or upscales an existing image using the configured image-gen provider (Vertex Imagen).
 */
export async function editImage(options: EditImageOptions): Promise<EditedImageResult> {
  const provider = resolveImageGenProvider();

  if (!isImageGenProviderSupported(provider)) {
    throw new Error(
      `Image generation provider "${provider}" is not supported. Use IMAGE_GEN_PROVIDER=vertex with GCP credentials.`,
    );
  }

  const adapter = createImageGenAdapter(provider);
  return adapter.editImage(options);
}
