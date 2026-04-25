import { google } from "googleapis";
export class ReadEmailTool {
  name = "read_email";
  description = "Read a Gmail email by message ID.";

  async run(input: { id: string }) {
    const clientId = process.env.GMAIL_CLIENT_ID;
    const clientSecret = process.env.GMAIL_CLIENT_SECRET;
    const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error("Missing Gmail credentials in .env");
    }
    const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oAuth2Client.setCredentials({ refresh_token: refreshToken });
    const gmail = google.gmail({ version: "v1", auth: oAuth2Client });
    const res = await gmail.users.messages.get({
      userId: "me",
      id: input.id,
      format: "full",
    });
    return res.data;
  }
}
