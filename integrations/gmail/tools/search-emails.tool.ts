import type { Tool, ToolContext } from "../../../common/interfaces/types.js";
import { getGmailClient } from "../gmail-auth.js";

export class SearchEmailsTool implements Tool {
  name = "search_emails";
  description = "Search Gmail emails by query string.";
  inputSchema = {
    type: "object",
    properties: {
      query: { type: "string", description: 'Gmail search query (supports operators e.g. "from:x").' },
      maxResults: { type: "number", description: "Default 5." },
    },
    required: ["query"],
  } as const;

  async run(input: Record<string, unknown>, _context: ToolContext): Promise<unknown> {
    const query = input.query;
    if (typeof query !== "string" || !query.trim()) {
      throw new Error("search_emails requires { query: string }.");
    }
    const maxResultsRaw = input.maxResults;
    const maxResults =
      typeof maxResultsRaw === "number" && Number.isFinite(maxResultsRaw)
        ? Math.floor(maxResultsRaw)
        : 5;

    const gmail = await getGmailClient();
    const res = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: maxResults > 0 ? maxResults : 5,
    });
    return res.data.messages || [];
  }
}
