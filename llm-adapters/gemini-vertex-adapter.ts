import { VertexAI, GenerativeModel, GenerateContentRequest } from "@google-cloud/vertexai";
import type { AgentDecision, LlmAdapter, LlmImageInput } from "../common/interfaces/types.js";
import { logLlmTokenUsage } from "./log-token-usage.js";
import { resolveVertexLocation } from "./vertex-config.js";

interface GeminiAdapterOptions {
  projectId: string;
  location?: string;
  model?: string;
}

export class GeminiVertexAdapter implements LlmAdapter {
  private vertexAI: VertexAI;
  private model: GenerativeModel;
  private readonly modelName: string;

  constructor(private readonly options: GeminiAdapterOptions) {
    this.modelName = options.model ?? "gemini-1.5-flash";
    this.vertexAI = new VertexAI({
      project: options.projectId,
      location: options.location ?? resolveVertexLocation(),
    });
    this.model = this.vertexAI.getGenerativeModel({
      model: this.modelName,
      generationConfig: {
        responseMimeType: "application/json",
      },
    });
  }

  async decide(prompt: string, systemPrompt?: string): Promise<AgentDecision> {
    const raw = await this.complete(prompt, systemPrompt, "decide");
    try {
      return JSON.parse(raw) as AgentDecision;
    } catch (e) {
      console.error("Failed to parse Gemini decision as JSON:", raw);
      throw e;
    }
  }

  async complete(prompt: string, systemPrompt?: string, operation = "complete"): Promise<string> {
    const request: GenerateContentRequest = {
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
    };

    if (systemPrompt) {
      request.systemInstruction = {
        role: "system",
        parts: [{ text: systemPrompt }],
      };
    }

    const result = await this.model.generateContent(request);
    const response = await result.response;
    this.logUsage(operation, response.usageMetadata);
    const text = response.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      throw new Error("Gemini returned an empty response.");
    }

    return text;
  }

  async completeWithImage(prompt: string, image: LlmImageInput): Promise<string> {
    const visionModel = this.vertexAI.getGenerativeModel({ model: this.modelName });
    const result = await visionModel.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            { inlineData: { mimeType: image.mimeType, data: image.dataBase64 } },
          ],
        },
      ],
    });

    const response = await result.response;
    this.logUsage("completeWithImage", response.usageMetadata);
    const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text?.trim()) {
      throw new Error("Gemini vision returned empty text.");
    }

    return text.trim();
  }

  private logUsage(
    operation: string,
    usage?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      cachedContentTokenCount?: number;
    },
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
