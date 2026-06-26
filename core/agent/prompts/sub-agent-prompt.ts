import type { BuiltPrompt, PromptBuilderInput } from "./types.js";
import { outputContract } from "./sections/output-contract.js";
import { decisionTypes } from "./sections/decision-types.js";
import { soulProfile } from "./sections/soul-profile.js";
import { toolsCatalog } from "./sections/tools-catalog.js";
import { skillsCatalog } from "./sections/skills-catalog.js";
import { iterationRules } from "./sections/iteration-rules.js";
import { currentGoal } from "./sections/current-goal.js";
import { subAgentIdentity } from "./sections/sub-agent-identity.js";
import { buildUserPrompt } from "./user-prompt.js";

export function buildSubAgentPrompt(input: PromptBuilderInput, recentMessages: string): BuiltPrompt {
  const memory =
    input.relevantLongTermMemory.map((m) => `- ${m.type}: ${m.content}`).join("\n") || "none";

  const domainInstructions = input.subAgentSystemPromptAppend?.trim()
    ? `---\n\n## Domain instructions\n\n${input.subAgentSystemPromptAppend.trim()}`
    : "";

  const systemPrompt = [
    subAgentIdentity(input.session.sessionId),
    outputContract(),
    decisionTypes("sub-agent"),
    soulProfile(input.soul, input.user),
    toolsCatalog(input.toolRegistry),
    skillsCatalog(input.skillRegistry),
    ...(domainInstructions ? [domainInstructions] : []),
    iterationRules({ iteration: input.iteration, maxIterations: input.maxIterations }),
    currentGoal(input.latestUserMessage, "DELEGATED TASK FROM PRINCIPAL", input.iteration),
  ].join("\n\n");

  const userPrompt = buildUserPrompt(input, recentMessages, memory, "Recent sub-session transcript");

  return { systemPrompt, userPrompt };
}
