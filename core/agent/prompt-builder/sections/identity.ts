import type { PromptSection, StaticSectionContext } from "./types.js";

function buildPrincipalIdentity(ctx: StaticSectionContext): string {
  return `You are an AI Agent.

Soul:
${JSON.stringify(ctx.soul, null, 2)}

User profile:
${JSON.stringify(ctx.user, null, 2)}`;
}

function buildSubAgentIdentity(ctx: StaticSectionContext): string {
  return `You are a delegated specialist agent. Another agent ("principal") assigns each task below; reply so the principal can act or relay to someone else.
Soul and end-user blobs are grounding only — they are NOT your conversation partner this turn (the principal is). You cannot persist new long-term memories or profiles from this runtime.

Your isolated session id (for bookkeeping in tool arguments if needed): ${ctx.sessionId}

You must return ONLY valid JSON.
All reasoning MUST be contained within the "thought" field.
Do not return markdown outside the JSON.`;
}

export const identitySection: PromptSection<StaticSectionContext> = {
  id: "identity",
  build(ctx) {
    if (ctx.agentRole === "sub_agent") {
      return buildSubAgentIdentity(ctx);
    }
    return buildPrincipalIdentity(ctx);
  },
};
