import type { DynamicSectionContext, PromptSection } from "../types.js";

export const lastObservationSection: PromptSection<DynamicSectionContext> = {
  id: "last-observation",
  build(ctx) {
    return `Last observation:\n${ctx.lastObservation || "none"}`;
  },
};
