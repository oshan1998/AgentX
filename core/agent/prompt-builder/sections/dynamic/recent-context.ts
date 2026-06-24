import type { DynamicSectionContext, PromptSection } from "../types.js";

export const recentContextSection: PromptSection<DynamicSectionContext> = {
  id: "recent-context",
  build(ctx) {
    return `${ctx.contextLabel}:\n${ctx.recentMessages}`;
  },
};
