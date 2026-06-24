import { formatToolCatalog } from "../formatters.js";
import type { PromptSection, StaticSectionContext } from "./types.js";

export const availableToolsSection: PromptSection<StaticSectionContext> = {
  id: "available-tools",
  when: (ctx) => ctx.toolRegistry.list().length > 0,
  build(ctx) {
    const includeSchemas =
      ctx.agentRole === "sub_agent" || ctx.profile !== "chat";

    const tools = formatToolCatalog(ctx.toolRegistry, includeSchemas);

    if (ctx.agentRole === "sub_agent") {
      return `Available tools:
${tools}`;
    }

    return `
==================================================
AVAILABLE TOOLS
==================================================

${tools}`;
  },
};
