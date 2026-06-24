import type { DynamicSectionContext, PromptSection } from "../types.js";

export const executionModeHintSection: PromptSection<DynamicSectionContext> = {
  id: "execution-mode-hint",
  when: (ctx) => ctx.iteration > 1,
  build() {
    return "EXECUTION MODE: Continue from Last observation. Your plan was set in iteration 1 — advance to the next step. Do NOT re-plan or reinterpret the original request as a new task.";
  },
};
