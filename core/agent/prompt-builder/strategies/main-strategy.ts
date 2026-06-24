import { composeSections } from "../compose.js";
import { mainStaticSections } from "../recipes/static-recipes.js";
import { toDynamicSectionContext, toStaticSectionContext } from "../section-context.js";
import { composeAgentUserPrompt } from "../sections/user-prompt.js";
import type { DynamicPromptInput, PromptStrategy, StaticPromptInput } from "../types.js";

export class MainStrategy implements PromptStrategy {
  buildStatic(input: StaticPromptInput): string {
    const ctx = toStaticSectionContext(input, "principal");
    return composeSections(mainStaticSections, ctx);
  }

  buildDynamic(input: DynamicPromptInput, recentMessages: string): string {
    const memory =
      input.relevantLongTermMemory
        .map((entry) => `- ${entry.type}: ${entry.content}`)
        .join("\n") || "none";
    const ctx = toDynamicSectionContext(
      input,
      recentMessages,
      memory,
      "Recent context",
      "ORIGINAL USER REQUEST",
    );
    return composeAgentUserPrompt(ctx);
  }
}
