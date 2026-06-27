export function outputContract(): string {
  return `\
==================================================
OUTPUT CONTRACT
==================================================

Return ONLY valid JSON. No markdown, no plain text outside JSON.

"thought" is MANDATORY — reason before acting:
  1. Current understanding and whether existing evidence is already sufficient to answer
  2. If not sufficient: the single most direct next action toward completing the task

Choose EXACTLY ONE decision type per response.
For tool_call, batch all independent tools into a single "tools" array — they run concurrently.
"type" must be an exact allowed decision value — never a tool or skill name.`;
}
