import type { DynamicPromptInput } from "../types.js";
import { formatCurrentGoalSection, formatIterationRulesSection } from "./iteration-rules.js";

export function formatAgentUserPrompt(
  input: DynamicPromptInput,
  recentMessages: string,
  memory: string,
  contextLabel: string,
  goalLabel: string,
): string {
  const iterationLine = `Iteration: ${input.iteration}/${input.maxIterations}`;
  const iterationRules = formatIterationRulesSection(input);
  const goalSection = formatCurrentGoalSection(input, goalLabel);
  const lastObservation = `Last observation:\n${input.lastObservation || "none"}`;
  const memorySection = `Relevant long-term memory:\n${memory}`;
  const contextSection = `${contextLabel}:\n${recentMessages}`;

  if (input.iteration === 1) {
    return `
${iterationLine}

${iterationRules}

${goalSection}

${memorySection}

${contextSection}

${lastObservation}
`.trim();
  }

  return `
${iterationLine}

EXECUTION MODE: Continue from Last observation. Do not reinterpret the original request as a new task.

${iterationRules}

${goalSection}

${lastObservation}

${contextSection}

${memorySection}
`.trim();
}
