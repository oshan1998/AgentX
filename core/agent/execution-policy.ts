/**
 * Determines what persistence side-effects runs are allowed (primary vs delegated sub-agents).
 */
export interface ExecutionPolicy {
  allowDecisionMemoryWrite: boolean;
  allowDecisionProfileWrite: boolean;
  allowSkillMemoryWrite: boolean;
  allowSkillProfileWrite: boolean;
}

export const PRIMARY_AGENT_EXECUTION_POLICY: ExecutionPolicy = {
  allowDecisionMemoryWrite: true,
  allowDecisionProfileWrite: true,
  allowSkillMemoryWrite: true,
  allowSkillProfileWrite: true,
};

/** Sub-agents observe memory via prompts / search_memory; persistence is delegated to principal. */
export const SUB_AGENT_EXECUTION_POLICY: ExecutionPolicy = {
  allowDecisionMemoryWrite: false,
  allowDecisionProfileWrite: false,
  allowSkillMemoryWrite: false,
  allowSkillProfileWrite: false,
};
