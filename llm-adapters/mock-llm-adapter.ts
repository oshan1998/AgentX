import { AgentDecision, LlmAdapter, LlmImageInput,DecisionType } from "../common/interfaces/types.js";

export class MockLlmAdapter implements LlmAdapter {
  async decide(prompt: string, _systemPrompt?: string): Promise<AgentDecision> {
    const lower = prompt.toLowerCase();
    if (lower.includes("list files") || lower.includes("list directory")) {
      return {
        type: DecisionType.ToolCall,
        tools: [{ tool: "list_directory", input: { path: "." } }],
        thought: "I need to list the files in the directory."
      };
    }
    if (lower.includes("remember")) {
      return {
        type: DecisionType.SkillCall,
        skill: "remember_fact",
        input: { type: "fact", content: "User asked to remember context." },
        thought: "I need to remember the context."
      };
    }
    return {
      type: DecisionType.Respond,
      message:
        "Mock adapter response: configure OPENAI_API_KEY for model-driven decisions.",
      thought: "I need to respond to the user.",
    };
  }

  async complete(prompt: string, _systemPrompt?: string): Promise<string> {
    if (prompt.length > 50000) {
      console.warn(`[WARNING] Prompt is very large: ${prompt.length} characters.`);
    }
    return `Mock completion for prompt: ${prompt.slice(0, 120)}`;
  }

  async completeWithImage(prompt: string, _image: LlmImageInput): Promise<string> {
    return `Mock vision analysis for prompt: ${prompt.slice(0, 120)}`;
  }
}
