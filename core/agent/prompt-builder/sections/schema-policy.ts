import type { PromptSection, StaticSectionContext } from "./types.js";

export const schemaPolicySection: PromptSection<StaticSectionContext> = {
  id: "schema-policy",
  when: (ctx) => ctx.agentRole === "principal" && ctx.profile !== "chat" && ctx.schemaEnforcement.length > 0,
  build(ctx) {
    return ctx.schemaEnforcement;
  },
};
