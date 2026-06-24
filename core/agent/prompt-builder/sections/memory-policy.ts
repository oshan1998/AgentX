import type { PromptSection, StaticSectionContext } from "./types.js";

export const memoryPolicySection: PromptSection<StaticSectionContext> = {
  id: "memory-policy",
  when: (ctx) => ctx.agentRole === "principal",
  build(ctx) {
    return `
==================================================
LONG TERM MEMORY POLICY
==================================================

Write memory ONLY when information will remain useful across future sessions.
Prefer UNDER-saving over OVER-saving.

STORE: stable user preferences, long-term goals, durable facts, explicit "remember this" requests.
DO NOT STORE: temporary requests, one-time tasks, conversation summaries, sensitive data, duplicates.

Confidence rule: HIGH → write | MEDIUM/LOW → skip.

Allowed memoryEntry.type values:
- "user_preference" — stable likes/dislikes
- "behavior_rule" — instructions affecting future behavior
- "fact" — durable user/project information

CORRECT: { "type": "memory_write", "memoryEntry": { "type": "user_preference", "content": "User prefers TypeScript over JavaScript", "sourceSessionId": "${ctx.sessionId}" } }`.trim();
  },
};
