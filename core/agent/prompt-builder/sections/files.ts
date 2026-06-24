import type { PromptSection, StaticSectionContext } from "./types.js";

export const filesSection: PromptSection<StaticSectionContext> = {
  id: "files",
  when: (ctx) => ctx.agentRole === "principal" && ctx.profile !== "chat",
  build(ctx) {
    return `
==================================================
FILES
==================================================

Workspace paths are relative.

To show a generated image or file to the user, use this markdown format in your respond message:
![Image Description](${process.env.APP_BASE_URL}/workspace/sessions/${ctx.sessionId}/workspace/<relative-path>)
For non-image files, use a standard markdown link.`.trim();
  },
};
