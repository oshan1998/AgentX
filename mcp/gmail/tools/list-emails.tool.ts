import { z } from "zod";
import type { Tool, ToolContext } from "../../../common/interfaces/types.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../_shared/zod-tool-schema.js";
import { getGmailClient } from "../services/gmail-auth.js";

export const listEmailsInputSchema = z
  .object({
    maxResults: z
      .number()
      .finite()
      .positive()
      .optional()
      .describe("Default 5."),
  })
  .describe("Optional cap on how many ids to fetch.");

export type ListEmailsInput = z.infer<typeof listEmailsInputSchema>;

export class ListEmailsTool implements Tool {
  name = "list_emails";
  description = "List recent emails from Gmail inbox.";
  inputSchema = zodSchemaToJsonInputSchema(listEmailsInputSchema);

  async run(input: Record<string, unknown>, _context: ToolContext): Promise<unknown> {
    const { maxResults: raw } = parseToolInput(this.name, listEmailsInputSchema, input);
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
