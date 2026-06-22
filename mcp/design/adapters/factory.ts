import type { ImageGenAdapter, LlmAdapter } from "../../../common/interfaces/types.js";
import { GeminiVertexAdapter } from "./gemini-vertex-adapter.js";
import { VertexImagenAdapter } from "./vertex-imagen-adapter.js";

const VISION_PROVIDERS = new Set(["openai", "gemini"]);
const IMAGE_GEN_PROVIDERS = new Set(["vertex"]);

export function resolveVisionProvider(): string {
  return (process.env.VISION_PROVIDER ?? process.env.LLM_PROVIDER ?? "gemini")
    .toLowerCase()
    .trim();
}

export function isVisionProviderSupported(provider: string): boolean {
  return VISION_PROVIDERS.has(provider);
}

export function createVisionLlmAdapter(provider = resolveVisionProvider()): LlmAdapter {
  switch (provider) {
    case "gemini": {
      if (!process.env.GOOGLE_CLOUD_PROJECT) {
        throw new Error("GOOGLE_CLOUD_PROJECT is required when VISION_PROVIDER is gemini");
      }
      return new GeminiVertexAdapter({
        projectId: process.env.GOOGLE_CLOUD_PROJECT,
        location: process.env.GOOGLE_CLOUD_LOCATION,
        model: process.env.GEMINI_VISION_MODEL ?? process.env.GEMINI_MODEL,
      });
    }
    default:
      throw new Error(
        `Vision provider "${provider}" is not supported in the design MCP server. Use gemini.`,
      );
  }
}

export function resolveImageGenProvider(): string {
  const raw = (process.env.IMAGE_GEN_PROVIDER ?? process.env.LLM_PROVIDER ?? "vertex")
    .toLowerCase()
    .trim();
  if (raw === "gemini") return "vertex";
  return raw;
}

export function isImageGenProviderSupported(provider: string): boolean {
  return IMAGE_GEN_PROVIDERS.has(provider);
}

export function createImageGenAdapter(provider = resolveImageGenProvider()): ImageGenAdapter {
  switch (provider) {
    case "vertex": {
      if (!process.env.GOOGLE_CLOUD_PROJECT) {
        throw new Error("GOOGLE_CLOUD_PROJECT is required when IMAGE_GEN_PROVIDER is vertex");
      }
      return new VertexImagenAdapter({
        projectId: process.env.GOOGLE_CLOUD_PROJECT,
        location: process.env.GOOGLE_CLOUD_LOCATION,
        model: process.env.IMAGEN_MODEL,
      });
    }
    default:
      throw new Error(
        `Image generation provider "${provider}" is not supported. Use IMAGE_GEN_PROVIDER=vertex.`,
      );
  }
}
