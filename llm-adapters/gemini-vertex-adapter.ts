import {
  GoogleGenAI,
  type GenerateContentResponseUsageMetadata,
} from "@google/genai";
import type {
  AgentDecision,
  LlmAdapter,
  LlmImageInput,
} from "../common/interfaces/types.js";
import { logLlmTokenUsage } from "./log-token-usage.js";
import { logLlmTokenUsage } from "./log-token-usage.js";
import { resolveVertexLocation } from "./vertex-config.js";

interface GeminiAdapterOptions {
  projectId: string;
  location?: string;
  model?: string;
}

export class GeminiVertexAdapter implements LlmAdapter {
  private readonly client: GoogleGenAI;
  private readonly modelName: string;

  constructor(private readonly options: GeminiAdapterOptions) {
    this.modelName = options.model ?? "gemini-1.5-flash";
    this.client = new GoogleGenAI({
      vertexai: true,
      project: options.projectId,
      location: options.location ?? resolveVertexLocation(),
    });
  }

  async decide(prompt: string, systemPrompt?: string): Promise<AgentDecision> {
    const raw = await this.complete(prompt, systemPrompt, "decide");
    const raw = await this.complete(prompt, systemPrompt, "decide");
    try {
      return JSON.parse(raw) as AgentDecision;
    } catch (e) {
      console.error("Failed to parse Gemini decision as JSON:", raw);
      throw e;
    }
  }

  async complete(
    prompt: string,
    systemPrompt?: string,
    operation = "complete",
  ): Promise<string> {
    const response = await this.client.models.generateContent({
      model: this.modelName,
      contents: prompt,
      config: {
        ...(systemPrompt ? { systemInstruction: systemPrompt } : {}),
        responseMimeType: "application/json",
      },
    });

    this.logUsage(operation, response.usageMetadata);
    const text = response.text;
    if (!text) {
      throw new Error("Gemini returned an empty response.");
    }

    return text;
  }

  async completeWithImage(
    prompt: string,
    image: LlmImageInput,
  ): Promise<string> {
    const response = await this.client.models.generateContent({
      model: this.modelName,
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            {
              inlineData: { mimeType: image.mimeType, data: image.dataBase64 },
            },
          ],
        },
      ],
    });

    this.logUsage("completeWithImage", response.usageMetadata);
    const text = response.text?.trim();
    if (!text) {
      throw new Error("Gemini vision returned empty text.");
    }

    return text;
  }

  private logUsage(
    operation: string,
    usage?: GenerateContentResponseUsageMetadata,
  ): void {
    logLlmTokenUsage({
      provider: "gemini",
      model: this.modelName,
      operation,
      inputTokens: usage?.promptTokenCount ?? 0,
      outputTokens: usage?.candidatesTokenCount ?? 0,
      cachedTokens: usage?.cachedContentTokenCount ?? 0,
    });
  }
}
