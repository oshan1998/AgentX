import type { PromptBuilderInput } from "./types.js";

export function buildUserPrompt(
  input: PromptBuilderInput,
  recentMessages: string,
  memory: string,
  contextLabel: string,
): string {
  const iterationLine = `Iteration: ${input.iteration}/${input.maxIterations}`;
  const lastObservation = `Last observation:\n${input.lastObservation ?? "none"}`;
  const memorySection = `Relevant long-term memory:\n${memory}`;
  const contextSection = `${contextLabel}:\n${recentMessages}`;

  const lastCarryover = [...input.session.messages]
    .reverse()
    .find((m) => m.meta?.carryover)?.content;
  const carryoverSection = lastCarryover
    ? `CARRYOVER FROM PREVIOUS ITERATION:\n${lastCarryover}`
    : null;

  if (input.iteration === 1) {
    return [iterationLine, memorySection, contextSection, lastObservation].join("\n\n");
  }

  return [
    iterationLine,
    "EXECUTION MODE: Continue from Last observation. Do not reinterpret the original request as a new task.",
    ...(carryoverSection ? [carryoverSection] : []),
    lastObservation,
    contextSection,
    memorySection,
  ].join("\n\n");
}
