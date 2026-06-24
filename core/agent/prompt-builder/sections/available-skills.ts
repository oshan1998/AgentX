import { formatSkillCatalog } from "../formatters.js";
import type { PromptSection, StaticSectionContext } from "./types.js";

export const availableSkillsSection: PromptSection<StaticSectionContext> = {
  id: "available-skills",
  when: (ctx) => ctx.skillRegistry.list().length > 0,
  build(ctx) {
    const includeSchemas =
      ctx.agentRole === "sub_agent" ||
      ctx.profile === "single_skill" ||
      ctx.profile === "planning";

    const skills = formatSkillCatalog(ctx.skillRegistry, includeSchemas);

    if (ctx.agentRole === "sub_agent") {
      return `Available skills (tag: [workflow] = step runner, [agentic] = specialist sub-agent):
${skills}`;
    }

    return `
==================================================
AVAILABLE SKILLS
==================================================

${skills}`;
  },
};
