import type { AgentDecision, LlmAdapter } from "../interfaces/types.js";

export interface OllamaAdapterOptions {
  model?: string;
  baseUrl?: string;
}

export class OllamaAdapter implements LlmAdapter {
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(options?: OllamaAdapterOptions) {
    this.model = options?.model ?? "qwen3:1.7b";
    this.baseUrl = options?.baseUrl ?? "http://localhost:11434";
  }

  async decide(prompt: string, systemPrompt?: string): Promise<AgentDecision> {
    const raw = await this.complete(prompt, systemPrompt);
    try {
      return JSON.parse(raw) as AgentDecision;
    } catch {
      const block = this.extractJsonBlock(raw);
      return JSON.parse(block) as AgentDecision;
    }
  }

  async complete(prompt: string, systemPrompt?: string): Promise<string> {
    if (prompt.length > 5000) {
      console.warn(`[WARNING] Prompt is very large: ${prompt.length} characters.`);
    }

    const fullPrompt = systemPrompt 
      ? `System: ${systemPrompt}\n\nUser: ${prompt}`
      : prompt;

    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        prompt: fullPrompt,
        stream: false,
        options: {
          temperature: 0,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama request failed (${response.status}): ${errorText}`);
    }

    const payload = (await response.json()) as {
      response?: string;
    };

    const raw = payload.response?.trim();
    if (raw === undefined) {
      throw new Error("Ollama response did not include readable text output.");
    }
    return raw;
  }

  private extractJsonBlock(text: string): string {
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first === -1 || last === -1 || last <= first) {
      throw new Error(`Model returned non-JSON response: ${text}`);
    }
    return text.slice(first, last + 1);
  }
}
