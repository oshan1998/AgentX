import type { AgentDecision, LlmAdapter } from "../common/interfaces/types.js";

export class MockLlmAdapter implements LlmAdapter {
  async decide(prompt: string, _systemPrompt?: string): Promise<AgentDecision> {
    const lower = prompt.toLowerCase();
    if (lower.includes("list files") || lower.includes("list directory")) {
      return {
        type: "tool_call",
        tool: "list_directory",
        input: { path: "." }
      };
    }
    if (lower.includes("remember")) {
      return {
        type: "skill_call",
        skill: "remember_fact",
        input: { type: "fact", content: "User asked to remember context." }
      };
    }
    return {
      type: "respond",
      message:
        "Mock adapter response: configure OPENAI_API_KEY for model-driven decisions."
    };
  }

  async complete(prompt: string, _systemPrompt?: string): Promise<string> {
    if (prompt.length > 50000) {
      console.warn(`[WARNING] Prompt is very large: ${prompt.length} characters.`);
    }
    return `Mock completion for prompt: ${prompt.slice(0, 120)}`;
  }
}
