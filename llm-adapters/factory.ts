import type { ImageGenAdapter, LlmAdapter } from "../common/interfaces/types.js";
import { OpenAIAdapter } from "./openai-adapter.js";
import { OllamaAdapter } from "./ollama-adapter.js";
import { MockLlmAdapter } from "./mock-llm-adapter.js";
import { GeminiVertexAdapter } from "./gemini-vertex-adapter.js";
import { VertexImagenAdapter } from "./vertex-imagen-adapter.js";

const VISION_PROVIDERS = new Set(["openai", "gemini"]);
const IMAGE_GEN_PROVIDERS = new Set(["vertex"]);

export function resolveVisionProvider(): string {
  return (process.env.VISION_PROVIDER ?? process.env.LLM_PROVIDER ?? "openai")
    .toLowerCase()
    .trim();
}

export function isVisionProviderSupported(provider: string): boolean {
  return VISION_PROVIDERS.has(provider);
}

export function createVisionLlmAdapter(provider = resolveVisionProvider()): LlmAdapter {
  switch (provider) {
    case "openai": {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY is required when VISION_PROVIDER is openai");
      }
      return new OpenAIAdapter({
        apiKey: process.env.OPENAI_API_KEY,
        model: process.env.OPENAI_VISION_MODEL ?? process.env.OPENAI_MODEL,
      });
    }
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
      throw new Error(`Vision provider "${provider}" is not supported. Use openai or gemini.`);
  }
}

export function resolveImageGenProvider(): string {
  const raw = (process.env.IMAGE_GEN_PROVIDER ?? process.env.LLM_PROVIDER ?? "vertex")
    .toLowerCase()
    .trim();
  // Gemini LLM uses the same GCP project/location for Vertex Imagen.
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
        `Image generation provider "${provider}" is not supported. Use IMAGE_GEN_PROVIDER=vertex with GCP credentials.`,
      );
  }
}

export function createLlmAdapter(overrides?: { model?: string }): LlmAdapter {
  const provider = process.env.LLM_PROVIDER || "mock";
  const modelOverride = overrides?.model?.trim() || undefined;

  switch (provider.toLowerCase()) {
    case "openai":
      if (!process.env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY is required when LLM_PROVIDER is openai");
      }
      return new OpenAIAdapter({
        apiKey: process.env.OPENAI_API_KEY,
        model: modelOverride ?? process.env.OPENAI_MODEL,
      });
    case "ollama":
      return new OllamaAdapter({
        model: modelOverride ?? process.env.OLLAMA_MODEL ?? "qwen3:1.7b",
        baseUrl: process.env.OLLAMA_API_BASE,
      });
    case "gemini":
      if (!process.env.GOOGLE_CLOUD_PROJECT) {
        throw new Error("GOOGLE_CLOUD_PROJECT is required when LLM_PROVIDER is gemini");
      }
      return new GeminiVertexAdapter({
        projectId: process.env.GOOGLE_CLOUD_PROJECT,
        location: process.env.GOOGLE_CLOUD_LOCATION,
        model: modelOverride ?? process.env.GEMINI_MODEL,
      });
    case "mock":
    default:
      return new MockLlmAdapter();
  }
}
