export function outputContract(): string {
  return `\
==================================================
OUTPUT CONTRACT
==================================================

Return ONLY valid JSON. No markdown, no plain text outside JSON.

"thought" is MANDATORY — reason before acting:
  1. Current understanding and relevant context
  2. Next action and why alternatives were rejected

Choose EXACTLY ONE decision type per response.
For tool_call, batch all independent tools into a single "tools" array — they run concurrently.
"type" must be an exact allowed decision value — never a tool or skill name.`;
}
