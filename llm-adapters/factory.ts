import type { LlmAdapter } from "../common/interfaces/types.js";
import { OpenAIAdapter } from "./llm-adapter.js";
import { OllamaAdapter } from "./ollama-adapter.js";
import { MockLlmAdapter } from "./mock-llm-adapter.js";
import { GeminiVertexAdapter } from "./gemini-vertex-adapter.js";

const VISION_PROVIDERS = new Set(["openai", "gemini"]);

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
