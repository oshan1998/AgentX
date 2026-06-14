import { z } from "zod";
import type { Tool, ToolContext } from "../../../common/interfaces/types.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../../common/services/zod-tool-schema.js";
import { getGmailClient } from "../gmail-auth.js";

export const readEmailInputSchema = z.object({
  id: z.string().min(1).describe("Gmail message id."),
});

export type ReadEmailInput = z.infer<typeof readEmailInputSchema>;

export class ReadEmailTool implements Tool {
  name = "read_email";
  description = "Read a Gmail email by message ID.";
  inputSchema = zodSchemaToJsonInputSchema(readEmailInputSchema);

  async run(input: Record<string, unknown>, _context: ToolContext): Promise<unknown> {
    const { id } = parseToolInput(this.name, readEmailInputSchema, input);
    const gmail = await getGmailClient();
    const res = await gmail.users.messages.get({
      userId: "me",
      id,
      format: "full",
    });
    return res.data;
  }
}
