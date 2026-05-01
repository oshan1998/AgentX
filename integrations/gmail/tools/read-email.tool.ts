import type { Tool, ToolContext } from "../../../common/interfaces/types.js";
import { getGmailClient } from "../gmail-auth.js";

export class ReadEmailTool implements Tool {
  name = "read_email";
  description = "Read a Gmail email by message ID.";
  inputSchema = {
    type: "object",
    properties: {
      id: { type: "string", description: "Gmail message id." },
    },
    required: ["id"],
  } as const;

  async run(input: Record<string, unknown>, _context: ToolContext): Promise<unknown> {
    const id = input.id;
    if (typeof id !== "string" || !id.trim()) {
      throw new Error("read_email requires { id: string }.");
    }
    const gmail = await getGmailClient();
    const res = await gmail.users.messages.get({
      userId: "me",
      id,
      format: "full",
    });
    return res.data;
  }
}
