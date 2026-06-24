import type { PromptSection, StaticSectionContext } from "./types.js";

export const domainAppendSection: PromptSection<StaticSectionContext> = {
  id: "domain-append",
  when: (ctx) => ctx.agentRole === "sub_agent" && Boolean(ctx.subAgentSystemPromptAppend?.trim()),
  build(ctx) {
    return `---\n\n## Domain instructions\n\n${ctx.subAgentSystemPromptAppend!.trim()}`;
  },
};
