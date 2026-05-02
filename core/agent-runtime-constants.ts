export const DELEGATE_SUB_AGENT_TOOL_NAME = "delegate_sub_agent";

/** Default iteration cap when the principal delegates a sub-agent task. */
export const SUB_AGENT_DEFAULT_MAX_ITERATIONS = 24;

/** Hard ceiling regardless of delegation input (safety valve). */
export const SUB_AGENT_HARD_MAX_ITERATIONS = 48;

/** Default wall-clock budget for a delegated run (milliseconds). */
export const SUB_AGENT_DEFAULT_WALL_CLOCK_MS = 120_000;

export const SUB_AGENT_HARD_MAX_WALL_CLOCK_MS = 600_000;
