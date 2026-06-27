import { z } from "zod";
import type { Tool, ToolContext } from "../../../common/interfaces/types.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../../common/services/zod-tool-schema.js";
import { getGmailClient } from "../gmail-auth.js";

export const searchEmailsInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe('Gmail search query (supports operators e.g. "from:x").'),
  maxResults: z.number().finite().optional().describe("Default 5."),
});

export type SearchEmailsInput = z.infer<typeof searchEmailsInputSchema>;

export class SearchEmailsTool implements Tool {
  name = "search_emails";
  description = "Search Gmail emails by query string.";
  inputSchema = zodSchemaToJsonInputSchema(searchEmailsInputSchema);

  async run(input: Record<string, unknown>, _context: ToolContext): Promise<unknown> {
    const { query, maxResults: maxResultsRaw } = parseToolInput(
      this.name,
      searchEmailsInputSchema,
      input,
    );
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
