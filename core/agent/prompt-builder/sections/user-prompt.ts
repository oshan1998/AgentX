import { composeSections } from "../compose.js";
import type { DynamicSectionContext, PromptSection } from "./types.js";
import { bootstrapCurrentMessageSection } from "./dynamic/bootstrap-current-message.js";
import { currentGoalSection } from "./dynamic/current-goal.js";
import { executionModeHintSection } from "./dynamic/execution-mode-hint.js";
import { iterationCounterSection } from "./dynamic/iteration-counter.js";
import { iterationUrgencySection } from "./dynamic/iteration-urgency.js";
import { lastObservationSection } from "./dynamic/last-observation.js";
import { longTermMemorySection } from "./dynamic/long-term-memory.js";
import { recentContextSection } from "./dynamic/recent-context.js";

const agentFirstIterationSections: PromptSection<DynamicSectionContext>[] = [
  iterationCounterSection,
  iterationUrgencySection,
  currentGoalSection,
  longTermMemorySection,
  recentContextSection,
  lastObservationSection,
];

const agentSubsequentIterationSections: PromptSection<DynamicSectionContext>[] = [
  iterationCounterSection,
  iterationUrgencySection,
  executionModeHintSection,
  currentGoalSection,
  lastObservationSection,
  recentContextSection,
  longTermMemorySection,
];

const bootstrapDynamicSections: PromptSection<DynamicSectionContext>[] = [
  bootstrapCurrentMessageSection,
  recentContextSection,
];

export function composeAgentUserPrompt(ctx: DynamicSectionContext): string {
  const sections =
    ctx.iteration === 1 ? agentFirstIterationSections : agentSubsequentIterationSections;
  return composeSections(sections, ctx);
}

export function composeBootstrapUserPrompt(ctx: DynamicSectionContext): string {
  return composeSections(bootstrapDynamicSections, ctx);
}
