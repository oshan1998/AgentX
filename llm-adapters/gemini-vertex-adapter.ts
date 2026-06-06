import { VertexAI, GenerativeModel, GenerateContentRequest } from "@google-cloud/vertexai";
import type { AgentDecision, LlmAdapter, LlmImageInput } from "../common/interfaces/types.js";
import { resolveVertexLocation } from "./vertex-config.js";

interface GeminiAdapterOptions {
  projectId: string;
  location?: string;
  model?: string;
}

export class GeminiVertexAdapter implements LlmAdapter {
  private vertexAI: VertexAI;
  private decisionModel: GenerativeModel;
  private textModel: GenerativeModel;
  private readonly modelName: string;

  constructor(private readonly options: GeminiAdapterOptions) {
    this.modelName = options.model ?? "gemini-1.5-flash";
    this.vertexAI = new VertexAI({
      project: options.projectId,
      location: options.location ?? resolveVertexLocation(),
    });
    this.decisionModel = this.vertexAI.getGenerativeModel({
      model: this.modelName,
      generationConfig: {
        responseMimeType: "application/json",
      },
    });
    this.textModel = this.vertexAI.getGenerativeModel({
      model: this.modelName,
    });
  }

  async decide(prompt: string, systemPrompt?: string): Promise<AgentDecision> {
    const raw = await this.generateText(this.decisionModel, prompt, systemPrompt);
    try {
      return JSON.parse(raw) as AgentDecision;
    } catch (e) {
      console.error("Failed to parse Gemini decision as JSON:", raw);
      throw e;
    }
  }

  async complete(prompt: string, systemPrompt?: string): Promise<string> {
    return this.generateText(this.textModel, prompt, systemPrompt);
  }

  private async generateText(
    model: GenerativeModel,
    prompt: string,
    systemPrompt?: string,
  ): Promise<string> {
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

    const result = await model.generateContent(request);
    const response = await result.response;
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
    const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text?.trim()) {
      throw new Error("Gemini vision returned empty text.");
    }

    return text.trim();
  }
}
