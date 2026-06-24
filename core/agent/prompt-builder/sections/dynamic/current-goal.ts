import type { DynamicSectionContext, PromptSection } from "../types.js";

export const currentGoalSection: PromptSection<DynamicSectionContext> = {
  id: "current-goal",
  build(ctx) {
    return `
==================================================
${ctx.goalLabel}
==================================================

${ctx.latestUserMessage}`.trim();
  },
};
