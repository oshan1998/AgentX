/**
 * Sub-agent delegation tool (manually registered in main.ts with AgentRuntimeFactory).
 *
 * Filename is NOT `*.tool.ts` — ToolManager would otherwise instantiate tools with `(memoryManager)` only,
 * but this runner needs factory-scoped deps.
 */
import type { Tool, ToolContext } from "../../../common/interfaces/types.js";
import {
  DELEGATE_SUB_AGENT_TOOL_NAME,
  SUB_AGENT_DEFAULT_MAX_ITERATIONS,
  SUB_AGENT_DEFAULT_WALL_CLOCK_MS,
  SUB_AGENT_HARD_MAX_ITERATIONS,
  SUB_AGENT_HARD_MAX_WALL_CLOCK_MS,
} from "../../../core/agent-runtime-constants.js";

export interface DelegateSubAgentRunner {
  runDelegatedTurn(input: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

export class DelegateSubAgentTool implements Tool {
  readonly name = DELEGATE_SUB_AGENT_TOOL_NAME;
  readonly description =
    "Delegate a focused sub-task to an isolated agent with its own session, allow-listed tools/skills, and budgets. " +
    "Sub-agents cannot write long-term memory or profiles; they return results for you to persist. " +
    "Do not include `delegate_sub_agent` in toolNames (recursion is blocked).";
  readonly inputSchema = {
    type: "object",
    properties: {
      task: {
        type: "string",
        description: "Clear instructions the sub-agent should execute.",
      },
      toolNames: {
        type: "array",
        items: { type: "string" },
        description: "Exact tool names the sub-agent may call (subset of your catalog).",
      },
      skillNames: {
        type: "array",
        items: { type: "string" },
        description: "Exact skill names the sub-agent may call (subset of your catalog).",
      },
      maxIterations: {
        type: "number",
        description: `Optional iteration cap (default ${SUB_AGENT_DEFAULT_MAX_ITERATIONS}, max ${SUB_AGENT_HARD_MAX_ITERATIONS}).`,
      },
      deadlineMs: {
        type: "number",
        description: `Optional wall-clock budget in ms (default ${SUB_AGENT_DEFAULT_WALL_CLOCK_MS}, max ${SUB_AGENT_HARD_MAX_WALL_CLOCK_MS}).`,
      },
    },
    required: ["task"],
  } as const;

  constructor(private readonly runner: DelegateSubAgentRunner) {}

  async run(input: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    return this.runner.runDelegatedTurn(input, context);
  }
}
