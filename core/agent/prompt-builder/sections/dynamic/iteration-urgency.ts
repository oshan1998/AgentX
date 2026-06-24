import type { DynamicSectionContext, PromptSection } from "../types.js";

export const iterationUrgencySection: PromptSection<DynamicSectionContext> = {
  id: "iteration-urgency",
  when: (ctx) => ctx.iteration >= ctx.maxIterations - 1,
  build(ctx) {
    return `URGENCY: You are on iteration ${ctx.iteration}/${ctx.maxIterations}. Finalize on this turn or the next — respond with the best available result and state anything incomplete.`;
  },
};
