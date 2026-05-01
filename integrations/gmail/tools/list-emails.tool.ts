import { getGmailClient } from "../gmail-auth.js";

export class ListEmailsTool {
  name = "list_emails";
  description = "List recent emails from Gmail inbox.";

  async run(input: { maxResults?: number }) {
    const gmail = await getGmailClient();
    const res = await gmail.users.messages.list({
      userId: "me",
      maxResults: input.maxResults || 5,
    });
    return res.data.messages || [];
  }
}
