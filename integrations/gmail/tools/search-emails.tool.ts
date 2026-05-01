import { getGmailClient } from "../gmail-auth.js";

export class SearchEmailsTool {
  name = "search_emails";
  description = "Search Gmail emails by query string.";

  async run(input: { query: string; maxResults?: number }) {
    const gmail = await getGmailClient();
    const res = await gmail.users.messages.list({
      userId: "me",
      q: input.query,
      maxResults: input.maxResults || 5,
    });
    return res.data.messages || [];
  }
}
