import type { Tool, ToolContext } from "../../../common/interfaces/types.js";
import { getGmailClient } from "../gmail-auth.js";

export class ListEmailsTool implements Tool {
  name = "list_emails";
  description = "List recent emails from Gmail inbox.";
  inputSchema = {
    type: "object",
    description: "Optional cap on how many ids to fetch.",
    properties: {
      maxResults: {
        type: "number",
        description: "Default 5.",
      },
    },
  };

  async run(input: Record<string, unknown>, _context: ToolContext): Promise<unknown> {
    const raw = input.maxResults;
    const maxResults =
      typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 5;

    const gmail = await getGmailClient();
    const res = await gmail.users.messages.list({
      userId: "me",
      maxResults,
    });
    return res.data.messages || [];
  }
}
