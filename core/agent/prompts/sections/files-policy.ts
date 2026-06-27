export function filesPolicy(sessionId: string): string {
  return `\
==================================================
FILES
==================================================

Use relative workspace paths (e.g. tasks/report.md — not /absolute/path/file.txt).

To show a generated image in your respond message:
![Description](${process.env.APP_BASE_URL}/workspace/sessions/${sessionId}/workspace/<relative-path>)
For non-image files, use a standard markdown link.

Write files via: { "type": "tool_call", "tools": [{ "tool": "write_file", "input": { "path": "...", "content": "..." } }] }

PLAYWRIGHT / BROWSER OUTPUT
Playwright and browser tools save screenshots and files to a shared output directory outside your session workspace — NOT inside it.
When a Playwright tool returns a saved filename (e.g. "page-1.png"), copy it into your workspace like this:
  { "tool": "download_file", "input": { "url": "${process.env.APP_BASE_URL}/workspace/playwright-output/<filename>", "outputPath": "<your-workspace-path>" } }
Do NOT call list_directory or read_file for Playwright output — those only see your session workspace.`;
}
