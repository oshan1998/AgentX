import type { DynamicSectionContext, PromptSection } from "../types.js";

export const longTermMemorySection: PromptSection<DynamicSectionContext> = {
  id: "long-term-memory",
  build(ctx) {
    return `Relevant long-term memory:\n${ctx.memory}`;
  },
};
