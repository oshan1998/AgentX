import type { LlmAdapter } from "../interfaces/types.js";
import { OpenAIAdapter } from "./llm-adapter.js";
import { OllamaAdapter } from "./ollama-adapter.js";
import { MockLlmAdapter } from "./mock-llm-adapter.js";

export function createLlmAdapter(): LlmAdapter {
  const provider = process.env.LLM_PROVIDER || "mock";

  switch (provider.toLowerCase()) {
    case "openai":
      if (!process.env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY is required when LLM_PROVIDER is openai");
      }
      return new OpenAIAdapter({
        apiKey: process.env.OPENAI_API_KEY,
        model: process.env.OPENAI_MODEL,
      });
    case "ollama":
      return new OllamaAdapter({
        model: process.env.OLLAMA_MODEL || "qwen3:1.7b",
        baseUrl: process.env.OLLAMA_API_BASE,
      });
    case "mock":
    default:
      return new MockLlmAdapter();
  }
}
