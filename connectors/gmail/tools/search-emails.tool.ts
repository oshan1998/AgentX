import { google } from "googleapis";
export class SearchEmailsTool {
  name = "search_emails";
  description = "Search Gmail emails by query string.";

  async run(input: { query: string; maxResults?: number }) {
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
      q: input.query,
      maxResults: input.maxResults || 5,
    });
    return res.data.messages || [];
  }
}
