import { z } from "zod";
import type { Tool, ToolContext } from "../../../common/interfaces/types.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../../common/services/zod-tool-schema.js";

/** Single source of truth: parsed input type + derived JSON Schema for the planner. */
export const askUserInputSchema = z.object({
  question: z.string().min(1).describe("The question to show the user."),
});

export type AskUserInput = z.infer<typeof askUserInputSchema>;

export class AskUserTool implements Tool {
  name = "ask_user";
  description = "Pause execution and ask the user a clarifying question when the request is ambiguous or missing critical details.";
  inputSchema = zodSchemaToJsonInputSchema(askUserInputSchema);

  async run(input: Record<string, unknown>, _context: ToolContext): Promise<unknown> {
    const { question } = parseToolInput(this.name, askUserInputSchema, input);
    return { question, requiresUserInput: true };
  }
}
