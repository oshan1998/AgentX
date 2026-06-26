import type { BuiltPrompt, PromptBuilderInput } from "./types.js";
import { buildBootstrapPrompt } from "./bootstrap-prompt.js";
import { buildSubAgentPrompt } from "./sub-agent-prompt.js";
import { buildMainPrompt } from "./main-prompt.js";

export type { BuiltPrompt, PromptBuilderInput };

const SESSION_MESSAGE_LIMIT = 20;

export class PromptBuilder {
  build(input: PromptBuilderInput): BuiltPrompt {
    const recentMessages =
      input.session.messages
        .slice(-SESSION_MESSAGE_LIMIT)
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n") || "none";

    if (!input.isSubAgent && !input.isBootstrapComplete) {
      return buildBootstrapPrompt(input, recentMessages);
    }

    if (input.isSubAgent) {
      return buildSubAgentPrompt(input, recentMessages);
    }

    return buildMainPrompt(input, recentMessages);
  }
}
