import type { AgentDecision, LlmAdapter } from "../interfaces/types.js";

interface OpenAIAdapterOptions {
  apiKey: string;
  model?: string;
}

export class OpenAIAdapter implements LlmAdapter {
  private readonly model: string;

  constructor(private readonly options: OpenAIAdapterOptions) {
    this.model = options.model ?? "gpt-4.1-mini";
  }

  async decide(prompt: string): Promise<AgentDecision> {
    const raw = await this.complete(prompt);
    try {
      return JSON.parse(raw) as AgentDecision;
    } catch {
      const block = this.extractJsonBlock(raw);
      return JSON.parse(block) as AgentDecision;
    }
  }

  async complete(prompt: string): Promise<string> {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.options.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: prompt }]
          }
        ],
        temperature: 0
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI request failed (${response.status}): ${errorText}`);
    }

    const payload = (await response.json()) as {
      output_text?: string;
      output?: Array<{
        type?: string;
        content?: Array<{
          type?: string;
          text?: string;
        }>;
      }>;
    };
    const raw = this.extractTextFromResponse(payload).trim();
    if (!raw) {
      throw new Error("OpenAI response did not include readable text output.");
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

  private extractTextFromResponse(payload: {
    output_text?: string;
    output?: Array<{
      type?: string;
      content?: Array<{
        type?: string;
        text?: string;
      }>;
    }>;
  }): string {
    if (typeof payload.output_text === "string" && payload.output_text.length > 0) {
      return payload.output_text;
    }

    const textChunks: string[] = [];
    for (const item of payload.output ?? []) {
      if (item.type !== "message") {
        continue;
      }
      for (const part of item.content ?? []) {
        if (part.type === "output_text" && typeof part.text === "string") {
          textChunks.push(part.text);
        }
      }
    }

    return textChunks.join("\n");
  }
}
