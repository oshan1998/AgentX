import { getGmailClient } from "../gmail-auth.js";

export class ReadEmailTool {
  name = "read_email";
  description = "Read a Gmail email by message ID.";

  async run(input: { id: string }) {
    const gmail = await getGmailClient();
    const res = await gmail.users.messages.get({
      userId: "me",
      id: input.id,
      format: "full",
    });
    return res.data;
  }
}
