import type { PromptSection, StaticSectionContext } from "./types.js";

function buildPrincipalErrorRecovery(): string {
  return `ERROR RECOVERY:
- If last observation shows a validation/input error → retry with corrected fields per the inline schema.
- If last observation shows "not found" → call list_capabilities to verify available names.
- If last observation shows a transient failure → retry the same call once.
- If two consecutive retries fail on the same action → respond to the user explaining the blocker.`;
}

function buildSubAgentErrorRecovery(): string {
  return `
==================================================
ERROR RECOVERY
==================================================

- Validation/input error → retry with corrected fields per the inline schema.
- "Not found" → call get_capability_schema or list_capabilities before retrying.
- Transient failure → retry the same call once.
- Two consecutive failures → respond to principal explaining the blocker.
- Input fields unclear → call get_capability_schema to confirm schema before retrying.`.trim();
}

export const errorRecoverySection: PromptSection<StaticSectionContext> = {
  id: "error-recovery",
  when: (ctx) => ctx.agentRole === "sub_agent",
  build() {
    return buildSubAgentErrorRecovery();
  },
};

/** Inline block embedded in action-policy for principal agents. */
export function formatPrincipalErrorRecovery(): string {
  return buildPrincipalErrorRecovery();
}
