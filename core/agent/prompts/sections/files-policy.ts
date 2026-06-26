export function filesPolicy(sessionId: string): string {
  return `\
==================================================
FILES
==================================================

Use relative workspace paths (e.g. tasks/report.md — not /absolute/path/file.txt).

To show a generated image in your respond message:
![Description](${process.env.APP_BASE_URL}/workspace/sessions/${sessionId}/workspace/<relative-path>)
For non-image files, use a standard markdown link.

Write files via: { "type": "tool_call", "tools": [{ "tool": "write_file", "input": { "path": "...", "content": "..." } }] }`;
}
