import type { PromptSection, StaticSectionContext } from "./types.js";

export const deliverableRulesSection: PromptSection<StaticSectionContext> = {
  id: "deliverable-rules",
  when: (ctx) => ctx.agentRole === "sub_agent",
  build() {
    return `
==================================================
DELIVERABLE RULES
==================================================

- Store deliverables inside your final "respond" message — the principal will persist preferences.
- When responding to the principal, always provide a comprehensive summary: actions taken,
  outcomes of each iteration, and any artifacts or file paths produced.
- If the result is partial due to an error or iteration limit, clearly state what was and was not completed.`.trim();
  },
};
