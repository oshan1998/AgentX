import type { LlmAdapter } from "../../../../common/interfaces/types.js";
import type { IntentResult, QueryComplexity, UserIntent } from "../types.js";

export interface IntentIdentificationParams {
  userInput: string;
  llm: LlmAdapter;
}

export interface IntentIdentificationResult {
  intent: IntentResult;
  queryComplexity: QueryComplexity;
}

function normalizeIntent(value: unknown): UserIntent {
  return value === "complex" ? "complex" : "simple";
}

export class IntentIdentificationService {
  async identify(params: IntentIdentificationParams): Promise<IntentIdentificationResult> {
    const systemPrompt = [
      "Classify the user query as simple or complex based on what is needed to answer it.",
      "simple: can be answered using only relevant long-term memory and the user's question — e.g. greetings, recall of past facts, explanations, advice, or general knowledge with no external actions.",
      "complex: also requires tools or skills — e.g. web search, live data, code execution, file or repo operations, API calls, email, or multi-step planning and execution.",
      'Respond with ONLY valid JSON matching this type: {"intent":"simple"|"complex"}',
    ].join(" ");

    const raw = await params.llm.complete(params.userInput, systemPrompt);

    try {
      const parsed = JSON.parse(raw.trim()) as { intent?: unknown };
      const label = normalizeIntent(parsed.intent);

      return {
        queryComplexity: label,
        intent: {
          label,
          signals: ["llm-classify"],
        },
      };
    } catch {
      return {
        queryComplexity: "simple",
        intent: { label: "simple", signals: ["llm-parse-fallback"] },
      };
    }
  }
}
