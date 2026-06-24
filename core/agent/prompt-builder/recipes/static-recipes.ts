import type { PromptSection, StaticSectionContext } from "../sections/types.js";
import { actionGatesSection } from "../sections/action-gates.js";
import { actionPolicySection } from "../sections/action-policy.js";
import { availableSkillsSection } from "../sections/available-skills.js";
import { availableToolsSection } from "../sections/available-tools.js";
import { bootstrapOnboardingSection } from "../sections/bootstrap-onboarding.js";
import { deliverableRulesSection } from "../sections/deliverable-rules.js";
import { domainAppendSection } from "../sections/domain-append.js";
import { efficiencyPolicySection } from "../sections/efficiency-policy.js";
import { errorRecoverySection } from "../sections/error-recovery.js";
import { filesSection } from "../sections/files.js";
import { identitySection } from "../sections/identity.js";
import { memoryPolicySection } from "../sections/memory-policy.js";
import { outputContractSection } from "../sections/output-contract.js";
import { primarySkillSection } from "../sections/primary-skill.js";
import { reasoningRulesSection } from "../sections/reasoning-rules.js";
import { schemaPolicySection } from "../sections/schema-policy.js";

export const mainStaticSections: PromptSection<StaticSectionContext>[] = [
  identitySection,
  outputContractSection,
  reasoningRulesSection,
  actionGatesSection,
  efficiencyPolicySection,
  memoryPolicySection,
  schemaPolicySection,
  actionPolicySection,
  filesSection,
  primarySkillSection,
  availableToolsSection,
  availableSkillsSection,
];

export const subAgentStaticSections: PromptSection<StaticSectionContext>[] = [
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

export const bootstrapStaticSections: PromptSection<StaticSectionContext>[] = [
  bootstrapOnboardingSection,
];
