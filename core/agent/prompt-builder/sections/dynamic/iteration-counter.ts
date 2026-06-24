import type { DynamicSectionContext, PromptSection } from "../types.js";

export const iterationCounterSection: PromptSection<DynamicSectionContext> = {
  id: "iteration-counter",
  build(ctx) {
    return `Iteration: ${ctx.iteration}/${ctx.maxIterations}`;
  },
};
