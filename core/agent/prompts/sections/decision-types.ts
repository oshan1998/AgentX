export type DecisionScope = "full" | "sub-agent" | "bootstrap";

export function decisionTypes(scope: DecisionScope, sessionId?: string): string {
  const respond = `Respond:
{
  "thought": "...",
  "type": "respond",
  "message": "..."
}`;

  const toolCall = `Tool call:
{
  "thought": "...",
  "type": "tool_call",
  "tool": "tool_name",
  "input": {}
}`;

  const skillCall = `Skill call:
{
  "thought": "...",
  "type": "skill_call",
  "skill": "skill_name",
  "input": {}
}`;

  const memoryWrite = `Persist memory:
{
  "thought": "...",
  "type": "memory_write",
  "memoryEntry": {
    "type": "user_preference | behavior_rule | fact",
    "content": "...",
    "sourceSessionId": "${sessionId ?? ""}"
  }
}`;

  const profileWrite = `Update profile:
{
  "thought": "...",
  "type": "profile_write",
  "target": "soul | user",
  "content": {}
}`;

  const header = `==================================================
ALLOWED DECISIONS
==================================================`;

  const blocks =
    scope === "bootstrap"
      ? [respond, skillCall]
      : scope === "sub-agent"
        ? [respond, toolCall, skillCall]
        : [respond, toolCall, skillCall, memoryWrite, profileWrite];

  return [header, ...blocks].join("\n\n");
}
