import type { PromptSection, StaticSectionContext } from "./types.js";

export const primarySkillSection: PromptSection<StaticSectionContext> = {
  id: "primary-skill",
  when: (ctx) =>
    ctx.agentRole === "principal" &&
    ctx.profile === "single_skill" &&
    Boolean(ctx.primarySkillName && ctx.primarySkillPrompt),
  build(ctx) {
    return `
==================================================
PRIMARY SKILL — ${ctx.primarySkillName}
==================================================

The router identified this skill as the best match for the user's request.
Prefer skill_call "${ctx.primarySkillName}" over hand-rolling equivalent tool_calls.

${ctx.primarySkillPrompt}`.trim();
  },
};
