import { VertexAI, GenerativeModel, GenerateContentRequest } from "@google-cloud/vertexai";
import type { AgentDecision, LlmAdapter } from "../interfaces/types.js";

interface GeminiAdapterOptions {
  projectId: string;
  location?: string;
  model?: string;
}

export class GeminiVertexAdapter implements LlmAdapter {
  private vertexAI: VertexAI;
  private model: GenerativeModel;

  constructor(private readonly options: GeminiAdapterOptions) {
    this.vertexAI = new VertexAI({
      project: options.projectId,
      location: options.location ?? "us-central1",
    });
    this.model = this.vertexAI.getGenerativeModel({
      model: options.model ?? "gemini-1.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
      },
    });
  }

  async decide(prompt: string, systemPrompt?: string): Promise<AgentDecision> {
    const raw = await this.complete(prompt, systemPrompt);
    try {
      return JSON.parse(raw) as AgentDecision;
    } catch (e) {
      console.error("Failed to parse Gemini decision as JSON:", raw);
      throw e;
    }
  }

  async complete(prompt: string, systemPrompt?: string): Promise<string> {
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
    const text = response.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      throw new Error("Gemini returned an empty response.");
    }

    return text;
  }
}
