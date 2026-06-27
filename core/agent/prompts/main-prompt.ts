import type { BuiltPrompt, PromptBuilderInput } from "./types.js";
import { outputContract } from "./sections/output-contract.js";
import { decisionTypes } from "./sections/decision-types.js";
import { soulProfile } from "./sections/soul-profile.js";
import { toolsCatalog } from "./sections/tools-catalog.js";
import { skillsCatalog } from "./sections/skills-catalog.js";
import { iterationRules } from "./sections/iteration-rules.js";
import { currentGoal } from "./sections/current-goal.js";
import { memoryPolicy } from "./sections/memory-policy.js";
import { actionPolicy } from "./sections/action-policy.js";
import { parallelismPolicy } from "./sections/parallelism-policy.js";
import { filesPolicy } from "./sections/files-policy.js";
import { buildUserPrompt } from "./user-prompt.js";

export function buildMainPrompt(input: PromptBuilderInput, recentMessages: string): BuiltPrompt {
  const memory =
    input.relevantLongTermMemory.map((m) => `- ${m.type}: ${m.content}`).join("\n") || "none";

  const systemPrompt = [
    "You are an AI Agent.",
    soulProfile(input.soul, input.user),
    outputContract(),
    decisionTypes("full", input.session.sessionId),
    memoryPolicy(),
    actionPolicy(),
    parallelismPolicy(),
    filesPolicy(input.session.sessionId),
    toolsCatalog(input.toolRegistry),
    skillsCatalog(input.skillRegistry),
    iterationRules({ iteration: input.iteration, maxIterations: input.maxIterations }),
    currentGoal(input.latestUserMessage, "ORIGINAL USER REQUEST", input.iteration),
  ].join("\n\n");

  const userPrompt = buildUserPrompt(input, recentMessages, memory, "Recent context");

  return { systemPrompt, userPrompt };
}
