import { selectMessagesForPrompt } from "../../../../common/services/prompt-truncation.js";
import { composeSections } from "../compose.js";
import { formatDynamicMemory, toDynamicSectionContext, toStaticSectionContext } from "../section-context.js";
import { actionGatesSection } from "../sections/action-gates.js";
import { availableSkillsSection } from "../sections/available-skills.js";
import { availableToolsSection } from "../sections/available-tools.js";
import { deliverableRulesSection } from "../sections/deliverable-rules.js";
import { domainAppendSection } from "../sections/domain-append.js";
import { efficiencyPolicySection } from "../sections/efficiency-policy.js";
import { errorRecoverySection } from "../sections/error-recovery.js";
import { identitySection } from "../sections/identity.js";
import { outputContractSection } from "../sections/output-contract.js";
import { reasoningRulesSection } from "../sections/reasoning-rules.js";
import { composeAgentUserPrompt } from "../sections/user-prompt.js";
import type { DynamicPromptInput, StaticPromptInput } from "../types.js";

const subAgentSections = [
  identitySection,
  outputContractSection,
  reasoningRulesSection,
  actionGatesSection,
  efficiencyPolicySection,
  errorRecoverySection,
  deliverableRulesSection,
  availableToolsSection,
  availableSkillsSection,
  domainAppendSection,
];

export function buildSubAgentSystemPrompt(input: StaticPromptInput): string {
  const ctx = toStaticSectionContext(input, "sub_agent");
  return composeSections(subAgentSections, ctx);
}

export function buildSubAgentUserPrompt(input: DynamicPromptInput): string {
  const recentMessages = selectMessagesForPrompt(input.messages, {
    lastObservation: input.lastObservation,
  });
  const memory = formatDynamicMemory(input);
  const ctx = toDynamicSectionContext(
    input,
    recentMessages,
    memory,
    "Recent sub-session transcript",
    "DELEGATED TASK FROM PRINCIPAL",
  );
  return composeAgentUserPrompt(ctx);
}
