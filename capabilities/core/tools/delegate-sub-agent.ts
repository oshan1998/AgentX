/**
 * Sub-agent delegation tool (manually registered in main.ts with AgentRuntimeFactory).
 *
 * Filename is NOT `*.tool.ts` — ToolManager would otherwise instantiate tools with `(memoryManager)` only,
 * but this runner needs factory-scoped deps.
 */
import { z } from "zod";
import type { Tool, ToolContext } from "../../../common/interfaces/types.js";
import {
  DELEGATE_SUB_AGENT_TOOL_NAME,
  SUB_AGENT_DEFAULT_MAX_ITERATIONS,
  SUB_AGENT_DEFAULT_WALL_CLOCK_MS,
  SUB_AGENT_HARD_MAX_ITERATIONS,
  SUB_AGENT_HARD_MAX_WALL_CLOCK_MS,
} from "../../../core/agent-runtime-constants.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../../common/services/zod-tool-schema.js";

export interface DelegateSubAgentRunner {
  runDelegatedTurn(input: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

export const delegateSubAgentInputSchema = z.object({
  task: z
    .union([z.string(), z.object({ text: z.string() })])
    .describe("Clear instructions the sub-agent should execute.")
    .refine(
      (v) =>
        typeof v === "string"
          ? v.trim().length > 0
          : typeof v.text === "string" && v.text.trim().length > 0,
      { message: "task must be a non-empty string or { text: string }" },
    ),
  toolNames: z
    .array(z.string())
    .optional()
    .describe("Exact tool names the sub-agent may call (subset of your catalog)."),
  skillNames: z
    .array(z.string())
    .optional()
    .describe("Exact skill names the sub-agent may call (subset of your catalog)."),
  maxIterations: z
    .number()
    .finite()
    .positive()
    .optional()
    .describe(
      `Optional iteration cap (default ${SUB_AGENT_DEFAULT_MAX_ITERATIONS}, max ${SUB_AGENT_HARD_MAX_ITERATIONS}).`,
    ),
  deadlineMs: z
    .number()
    .finite()
    .positive()
    .optional()
    .describe(
      `Optional wall-clock budget in ms (default ${SUB_AGENT_DEFAULT_WALL_CLOCK_MS}, max ${SUB_AGENT_HARD_MAX_WALL_CLOCK_MS}).`,
    ),
  systemPromptAppend: z
    .string()
    .optional()
    .describe(
      "Optional text appended after the base delegated-specialist system prompt (domain instructions).",
    ),
});

export type DelegateSubAgentInput = z.infer<typeof delegateSubAgentInputSchema>;

export class DelegateSubAgentTool implements Tool {
  readonly name = DELEGATE_SUB_AGENT_TOOL_NAME;
  readonly description =
    "Delegate a focused sub-task to an isolated agent with its own session, allow-listed tools/skills, and budgets. " +
    "Sub-agents cannot write long-term memory or profiles; they return results for you to persist. " +
    "Do not include `delegate_sub_agent` in toolNames (recursion is blocked).";
  readonly inputSchema = zodSchemaToJsonInputSchema(delegateSubAgentInputSchema);

  constructor(private readonly runner: DelegateSubAgentRunner) {}

  async run(input: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const validated = parseToolInput(this.name, delegateSubAgentInputSchema, input);
    return this.runner.runDelegatedTurn(validated as Record<string, unknown>, context);
  }
}
