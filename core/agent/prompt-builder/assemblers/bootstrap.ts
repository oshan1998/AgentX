import { selectMessagesForPrompt } from "../../../../common/services/prompt-truncation.js";
import { composeSections } from "../compose.js";
import { toDynamicSectionContext, toStaticSectionContext } from "../section-context.js";
import { bootstrapOnboardingSection } from "../sections/bootstrap-onboarding.js";
import { composeBootstrapUserPrompt } from "../sections/user-prompt.js";
import type { DynamicPromptInput, StaticPromptInput } from "../types.js";

const bootstrapSections = [bootstrapOnboardingSection];

export function buildBootstrapSystemPrompt(input: StaticPromptInput): string {
  const ctx = toStaticSectionContext(input, "bootstrap");
  return composeSections(bootstrapSections, ctx);
}

export function buildBootstrapUserPrompt(input: DynamicPromptInput): string {
  const recentMessages = selectMessagesForPrompt(input.messages, {
    lastObservation: input.lastObservation,
  });
  const ctx = toDynamicSectionContext(input, recentMessages, "", "Recent context", "");
  return composeBootstrapUserPrompt(ctx);
}
