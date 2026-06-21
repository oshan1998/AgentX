import type { DynamicPromptInput } from "../types.js";
import {
  formatCurrentGoalSection,
  formatIterationUrgencySection,
} from "./iteration-rules.js";

export function formatAgentUserPrompt(
  input: DynamicPromptInput,
  recentMessages: string,
  memory: string,
  contextLabel: string,
  goalLabel: string,
): string {
  const iterationLine = `Iteration: ${input.iteration}/${input.maxIterations}`;
  const urgencySection = formatIterationUrgencySection(input);
  const goalSection = formatCurrentGoalSection(input, goalLabel);
  const lastObservation = `Last observation:\n${input.lastObservation || "none"}`;
  const memorySection = `Relevant long-term memory:\n${memory}`;
  const contextSection = `${contextLabel}:\n${recentMessages}`;

  if (input.iteration === 1) {
    return [
      iterationLine,
      urgencySection,
      goalSection,
      memorySection,
      contextSection,
      lastObservation,
    ]
      .filter((section): section is string => Boolean(section))
      .join("\n\n");
  }

  return [
    iterationLine,
    urgencySection,
    "EXECUTION MODE: Continue from Last observation. Your plan was set in iteration 1 — advance to the next step. Do NOT re-plan or reinterpret the original request as a new task.",
    goalSection,
    lastObservation,
    contextSection,
    memorySection,
  ]
    .filter((section): section is string => Boolean(section))
    .join("\n\n");
}
