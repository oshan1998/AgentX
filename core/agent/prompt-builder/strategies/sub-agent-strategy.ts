import { composeSections } from "../compose.js";
import { subAgentStaticSections } from "../recipes/static-recipes.js";
import {
  formatDynamicMemory,
  toDynamicSectionContext,
  toStaticSectionContext,
} from "../section-context.js";
import { composeAgentUserPrompt } from "../sections/user-prompt.js";
import type { DynamicPromptInput, PromptStrategy, StaticPromptInput } from "../types.js";

export class SubAgentStrategy implements PromptStrategy {
  buildStatic(input: StaticPromptInput): string {
    const ctx = toStaticSectionContext(input, "sub_agent");
    return composeSections(subAgentStaticSections, ctx);
  }

  buildDynamic(input: DynamicPromptInput, recentMessages: string): string {
    const memory = formatDynamicMemory(input);
    const ctx = toDynamicSectionContext(
      input,
      recentMessages,
      memory,
      "Recent sub-session transcript",
      "DELEGATED TASK FROM PRINCIPAL",
    );
    return composeAgentUserPrompt(ctx);
  }
}
