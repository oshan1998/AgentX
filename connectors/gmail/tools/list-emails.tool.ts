import { google } from "googleapis";

export class ListEmailsTool {
  name = "list_emails";
  description = "List recent emails from Gmail inbox.";

  async run(input: { maxResults?: number }) {
    const clientId = process.env.GMAIL_CLIENT_ID;
    const clientSecret = process.env.GMAIL_CLIENT_SECRET;
    const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error("Missing Gmail credentials in .env");
    }
    const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oAuth2Client.setCredentials({ refresh_token: refreshToken });
    const gmail = google.gmail({ version: "v1", auth: oAuth2Client });
    const res = await gmail.users.messages.list({
      userId: "me",
      maxResults: input.maxResults || 5,
    });
    const messages = res.data.messages || [];
    return messages;
  }
}
