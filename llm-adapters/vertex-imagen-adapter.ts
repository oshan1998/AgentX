import {
  EditMode,
  GoogleGenAI,
  MaskReferenceImage,
  MaskReferenceMode,
  PersonGeneration,
  RawReferenceImage,
} from "@google/genai";
import type {
  ImageEditInput,
  ImageEditMode,
  ImageGenAdapter,
  ImageGenInput,
  ImageGenResult,
  PersonGenerationSetting,
} from "../common/interfaces/types.js";
import { resolveVertexLocation, resolveVertexProject } from "./vertex-config.js";

export interface VertexImagenAdapterOptions {
  projectId?: string;
  location?: string;
  model?: string;
  editModel?: string;
  upscaleModel?: string;
}

const EDIT_MODE_MAP: Record<Exclude<ImageEditMode, "upscale">, EditMode> = {
  default: EditMode.EDIT_MODE_DEFAULT,
  inpaint_insert: EditMode.EDIT_MODE_INPAINT_INSERTION,
  inpaint_remove: EditMode.EDIT_MODE_INPAINT_REMOVAL,
  outpaint: EditMode.EDIT_MODE_OUTPAINT,
  background_swap: EditMode.EDIT_MODE_BGSWAP,
  style: EditMode.EDIT_MODE_STYLE,
};

function resolvePersonGeneration(override?: PersonGenerationSetting): PersonGeneration {
  const raw = (override ?? process.env.IMAGEN_PERSON_GENERATION ?? "allow_all")
    .toLowerCase()
    .trim()
    .replace(/-/g, "_");

  if (raw === "allow_adult" || raw === "adults_only") {
    return PersonGeneration.ALLOW_ADULT;
  }
  if (raw === "dont_allow" || raw === "block") {
    return PersonGeneration.DONT_ALLOW;
  }
  return PersonGeneration.ALLOW_ALL;
}

function mimeTypeFromOutput(outputMimeType?: string): string {
  if (outputMimeType === "image/jpeg") return "image/jpeg";
  if (outputMimeType === "image/webp") return "image/webp";
  return "image/png";
}

function extractGeneratedImage(
  generatedImages: Array<{ image?: { imageBytes?: string }; raiFilteredReason?: string }> | undefined,
  provider: string,
  model: string,
  outputMimeType?: string,
): ImageGenResult {
  const generated = generatedImages?.[0];
  const imageBytes = generated?.image?.imageBytes;

  if (!imageBytes) {
    const reason = generated?.raiFilteredReason;
    if (reason) {
      throw new Error(`Image edit blocked by safety filters: ${reason}`);
    }
    throw new Error("Image edit returned no image bytes.");
  }

  return {
    buffer: Buffer.from(imageBytes, "base64"),
    mimeType: mimeTypeFromOutput(outputMimeType),
    provider,
    model,
    raiFilteredReason: generated.raiFilteredReason ?? undefined,
  };
}

export class VertexImagenAdapter implements ImageGenAdapter {
  readonly provider = "vertex";
  readonly model: string;
  private readonly editModel: string;
  private readonly upscaleModel: string;
  private readonly client: GoogleGenAI;

  constructor(options: VertexImagenAdapterOptions = {}) {
    this.model = options.model?.trim() || process.env.IMAGEN_MODEL?.trim() || "imagen-4.0-fast-generate-001";
    this.editModel =
      options.editModel?.trim() ||
      process.env.IMAGEN_EDIT_MODEL?.trim() ||
      "imagen-3.0-capability-001";
    this.upscaleModel =
      options.upscaleModel?.trim() ||
      process.env.IMAGEN_UPSCALE_MODEL?.trim() ||
      "imagen-4.0-upscale-preview";
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
        personGeneration: resolvePersonGeneration(input.personGeneration),
      },
    });

    return extractGeneratedImage(response.generatedImages, this.provider, this.model);
  }

  async editImage(input: ImageEditInput): Promise<ImageGenResult> {
    const mode = input.mode ?? "default";

    if (mode === "upscale") {
      return this.upscaleImage(input);
    }

    const prompt = input.prompt?.trim();
    if (!prompt) {
      throw new Error("prompt is required for image edit modes other than upscale.");
    }

    const rawReference = new RawReferenceImage();
    rawReference.referenceId = 1;
    rawReference.referenceImage = {
      imageBytes: input.sourceImage.toString("base64"),
      mimeType: input.sourceMimeType,
    };

    const referenceImages = [rawReference];

    if (input.maskImage) {
      const maskReference = new MaskReferenceImage();
      maskReference.referenceId = 2;
      maskReference.referenceImage = {
        imageBytes: input.maskImage.toString("base64"),
        mimeType: input.maskMimeType ?? "image/png",
      };
      maskReference.config = {
        maskMode: MaskReferenceMode.MASK_MODE_USER_PROVIDED,
      };
      referenceImages.push(maskReference);
    }

    const response = await this.client.models.editImage({
      model: this.editModel,
      prompt,
      referenceImages,
      config: {
        editMode: EDIT_MODE_MAP[mode],
        numberOfImages: 1,
        includeRaiReason: true,
        personGeneration: resolvePersonGeneration(input.personGeneration),
        ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
        ...(input.negativePrompt ? { negativePrompt: input.negativePrompt } : {}),
      },
    });

    return extractGeneratedImage(
      response.generatedImages,
      this.provider,
      this.editModel,
      response.generatedImages?.[0]?.image?.mimeType,
    );
  }

  private async upscaleImage(input: ImageEditInput): Promise<ImageGenResult> {
    const response = await this.client.models.upscaleImage({
      model: this.upscaleModel,
      image: {
        imageBytes: input.sourceImage.toString("base64"),
        mimeType: input.sourceMimeType,
      },
      upscaleFactor: input.upscaleFactor ?? "x2",
      config: {
        includeRaiReason: true,
        personGeneration: resolvePersonGeneration(input.personGeneration),
      },
    });

    return extractGeneratedImage(
      response.generatedImages,
      this.provider,
      this.upscaleModel,
      response.generatedImages?.[0]?.image?.mimeType,
    );
  }
}
