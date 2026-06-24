import type { DynamicSectionContext, PromptSection } from "../types.js";

export const bootstrapCurrentMessageSection: PromptSection<DynamicSectionContext> = {
  id: "bootstrap-current-message",
  build(ctx) {
    return `Current user message:
${ctx.latestUserMessage}`;
  },
};
