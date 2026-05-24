import { GoogleGenAI } from "@google/genai";
import type { ImageGenAdapter, ImageGenInput, ImageGenResult } from "../common/interfaces/types.js";
import { resolveVertexLocation, resolveVertexProject } from "./vertex-config.js";

export interface VertexImagenAdapterOptions {
  projectId?: string;
  location?: string;
  model?: string;
}

export class VertexImagenAdapter implements ImageGenAdapter {
  readonly provider = "vertex";
  readonly model: string;
  private readonly client: GoogleGenAI;

  constructor(options: VertexImagenAdapterOptions = {}) {
    this.model = options.model?.trim() || process.env.IMAGEN_MODEL?.trim() || "imagen-4.0-fast-generate-001";
    this.client = new GoogleGenAI({
      vertexai: true,
      project: options.projectId ?? resolveVertexProject(),
      location: options.location ?? resolveVertexLocation(),
    });
  }

  async generateImage(input: ImageGenInput): Promise<ImageGenResult> {
    const response = await this.client.models.generateImages({
      model: this.model,
      prompt: input.prompt,
      config: {
        numberOfImages: input.numberOfImages ?? 1,
        ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
        includeRaiReason: true,
      },
    });

    const generated = response.generatedImages?.[0];
    const imageBytes = generated?.image?.imageBytes;

    if (!imageBytes) {
      const reason = generated?.raiFilteredReason;
      if (reason) {
        throw new Error(`Image generation blocked by safety filters: ${reason}`);
      }
      throw new Error("Image generation returned no image bytes.");
    }

    return {
      buffer: Buffer.from(imageBytes, "base64"),
      mimeType: "image/png",
      provider: this.provider,
      model: this.model,
      raiFilteredReason: generated.raiFilteredReason ?? undefined,
    };
  }
}
