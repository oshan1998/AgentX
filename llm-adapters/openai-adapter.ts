import type { AgentDecision, LlmAdapter, LlmImageInput } from "../common/interfaces/types.js";

interface OpenAIAdapterOptions {
  apiKey: string;
  model?: string;
}

export class OpenAIAdapter implements LlmAdapter {
  private readonly model: string;

  constructor(private readonly options: OpenAIAdapterOptions) {
    this.model = options.model ?? "gpt-4.1-mini";
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

    const messages = [];
    if (systemPrompt) {
      messages.push({
        role: "system",
        content: [{ type: "input_text", text: systemPrompt }]
      });
    }
    messages.push({
      role: "user",
      content: [{ type: "input_text", text: prompt }]
    });

    const raw = await this.postResponses({ model: this.model, input: messages, temperature: 0 });
    if (!raw) {
      throw new Error("OpenAI response did not include readable text output.");
    }
    return raw;
  }

  async completeWithImage(prompt: string, image: LlmImageInput): Promise<string> {
    const raw = await this.postResponses({
      model: this.model,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            {
              type: "input_image",
              image_url: `data:${image.mimeType};base64,${image.dataBase64}`,
            },
          ],
        },
      ],
      temperature: 0,
    });
    if (!raw) {
      throw new Error("OpenAI vision returned empty text.");
    }
    return raw;
  }

  private async postResponses(body: Record<string, unknown>): Promise<string> {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify(body),
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
    return this.extractTextFromResponse(payload).trim();
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
