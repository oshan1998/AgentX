import type { Tool, ToolContext } from "../../../common/interfaces/types.js";

export class AskUserTool implements Tool {
  name = "ask_user";
  description = "Create a follow-up question for the user.";
  inputSchema = {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "The question to show the user.",
      },
    },
    required: ["question"],
  } as const;

  async run(input: Record<string, unknown>, _context: ToolContext): Promise<unknown> {
    const question = input.question;
    if (typeof question !== "string" || question.length === 0) {
      throw new Error("ask_user requires { question: string }.");
    }
    return { question, requiresUserInput: true };
  }
}
