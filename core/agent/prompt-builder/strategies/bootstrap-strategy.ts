import { composeSections } from "../compose.js";
import { bootstrapStaticSections } from "../recipes/static-recipes.js";
import { toDynamicSectionContext, toStaticSectionContext } from "../section-context.js";
import { composeBootstrapUserPrompt } from "../sections/user-prompt.js";
import type { DynamicPromptInput, PromptStrategy, StaticPromptInput } from "../types.js";

export class BootstrapStrategy implements PromptStrategy {
  buildStatic(input: StaticPromptInput): string {
    const ctx = toStaticSectionContext(input, "bootstrap");
    return composeSections(bootstrapStaticSections, ctx);
  }

  buildDynamic(input: DynamicPromptInput, recentMessages: string): string {
    const ctx = toDynamicSectionContext(input, recentMessages, "", "Recent context", "");
    return composeBootstrapUserPrompt(ctx);
  }
}
