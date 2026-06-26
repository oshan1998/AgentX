export function memoryPolicy(): string {
  return `\
==================================================
MEMORY POLICY
==================================================

Write memory_write ONLY for information useful across future sessions.

Write for:
- User preferences (language, tools, style, tone)
- Long-term goals and recurring workflows
- Stable facts (profession, expertise, project context)
- Explicit requests ("remember this", "from now on", "save this")

Do NOT write for:
- One-time tasks, temporary requests, large summaries, sensitive data, duplicates

Confidence rule: HIGH → write · MEDIUM → skip · LOW → skip
Prefer under-saving over over-saving.

Types: "user_preference" | "behavior_rule" | "fact"`;
}
