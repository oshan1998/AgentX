import { actionGatesSection } from "../prompt-builder/sections/action-gates.js";
import { actionPolicySection } from "../prompt-builder/sections/action-policy.js";
import { availableSkillsSection } from "../prompt-builder/sections/available-skills.js";
import { availableToolsSection } from "../prompt-builder/sections/available-tools.js";
import { efficiencyPolicySection } from "../prompt-builder/sections/efficiency-policy.js";
import { filesSection } from "../prompt-builder/sections/files.js";
import { identitySection } from "../prompt-builder/sections/identity.js";
import { memoryPolicySection } from "../prompt-builder/sections/memory-policy.js";
import { outputContractSection } from "../prompt-builder/sections/output-contract.js";
import { reasoningRulesSection } from "../prompt-builder/sections/reasoning-rules.js";
import { schemaPolicySection } from "../prompt-builder/sections/schema-policy.js";
import type { PromptSection, StaticSectionContext } from "../prompt-builder/sections/types.js";

/** Always injected for every routed turn (simple and complex). */
export const routedCoreSections: PromptSection<StaticSectionContext>[] = [
  identitySection,
  outputContractSection,
  reasoningRulesSection,
  actionGatesSection,
  memoryPolicySection,
];

/** Injected for complex routes — execution policies and selected capabilities. */
export const routedComplexSections: PromptSection<StaticSectionContext>[] = [
  efficiencyPolicySection,
  schemaPolicySection,
  actionPolicySection,
  filesSection,
  availableToolsSection,
  availableSkillsSection,
];
