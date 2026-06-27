import type { BuiltPrompt, PromptBuilderInput } from "./types.js";
import { buildBootstrapPrompt } from "./bootstrap-prompt.js";
import { buildSubAgentPrompt } from "./sub-agent-prompt.js";
import { buildMainPrompt } from "./main-prompt.js";

export type { BuiltPrompt, PromptBuilderInput };

const SESSION_MESSAGE_LIMIT = 20;
const MAX_MESSAGE_CONTENT_LENGTH = 2000;

function truncate(content: string): string {
  if (content.length <= MAX_MESSAGE_CONTENT_LENGTH) return content;
  return content.slice(0, MAX_MESSAGE_CONTENT_LENGTH) + `... [truncated ${content.length - MAX_MESSAGE_CONTENT_LENGTH} chars]`;
}

export class PromptBuilder {
  build(input: PromptBuilderInput): BuiltPrompt {
    const recentMessages =
      input.session.messages
        .slice(-SESSION_MESSAGE_LIMIT)
        .filter((m) => !m.meta?.carryover)
        .map((m) => `${m.role}: ${truncate(m.content)}`)
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
