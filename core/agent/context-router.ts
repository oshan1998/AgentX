import { SkillRegistry, ToolRegistry } from "../../common/interfaces/registry.js";
import type { LongTermMemoryEntry, LlmAdapter, Skill, Tool } from "../../common/interfaces/types.js";
import type { MemoryManager } from "../../managers/memory-manager.js";
import type { VectorManager } from "../../managers/vector-manager.js";
import { getSkillPromptMarkdown } from "../skills/skill-prompt.js";
import { logger } from "../../common/services/logger.js";
import {
  DEFAULT_MIN_CAPABILITY_SCORE,
  DEFAULT_RETRIEVED_SKILL_LIMIT,
  DEFAULT_RETRIEVED_TOOL_LIMIT,
  DEFAULT_SINGLE_SKILL_SCORE_GAP,
  isAlwaysOnToolName,
  isMetaToolName,
  isPlanningToolName,
  META_TOOL_NAMES,
  PLANNING_SKILL_NAMES,
  PLANNING_TOOL_NAMES,
  type CapabilityRetrievalMethod,
  retrieveCapabilities,
  resolveCapabilityRetrievalMethod,
} from "./capability-retriever.js";

export type PromptProfile = "chat" | "tooling" | "single_skill" | "multi_skill" | "planning";

export interface ContextPreprocessParams {
  userInput: string;
  llm: LlmAdapter;
  memoryManager: MemoryManager;
  allTools: Tool[];
  allSkills: Skill[];
  vectorManager?: VectorManager;
  capabilityRetrievalMethod?: CapabilityRetrievalMethod;
  toolLimit?: number;
  skillLimit?: number;
}

export interface ContextRouteResult {
  profile: PromptProfile;
  toolRegistry: ToolRegistry;
  skillRegistry: SkillRegistry;
  relevantLongTermMemory: LongTermMemoryEntry[];
  primarySkill?: Skill;
  primarySkillPrompt?: string;
  retrievalMethod: CapabilityRetrievalMethod;
}

function resolveMinCapabilityScore(): number {
  const raw = process.env.CONTEXT_MIN_CAPABILITY_SCORE?.trim();
  if (!raw) return DEFAULT_MIN_CAPABILITY_SCORE;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : DEFAULT_MIN_CAPABILITY_SCORE;
}

function resolveSingleSkillScoreGap(): number {
  const raw = process.env.CONTEXT_SINGLE_SKILL_SCORE_GAP?.trim();
  if (!raw) return DEFAULT_SINGLE_SKILL_SCORE_GAP;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : DEFAULT_SINGLE_SKILL_SCORE_GAP;
}

function isPlanningIntent(userInput: string, skillNames: string[]): boolean {
  if (skillNames.some((name) => (PLANNING_SKILL_NAMES as readonly string[]).includes(name))) {
    return true;
  }
  return /\b(plan|orchestrate|multi-?step|task graph|break down|roadmap)\b/i.test(userInput);
}

function filterActionToolScores(
  toolScores: { item: Tool; score: number }[],
  minScore: number,
): { item: Tool; score: number }[] {
  return toolScores.filter(
    (entry) =>
      !isMetaToolName(entry.item.name) &&
      !isPlanningToolName(entry.item.name) &&
      entry.score >= minScore,
  );
}

function filterRelevantSkillScores(
  skillScores: { item: Skill; score: number }[],
  minScore: number,
): { item: Skill; score: number }[] {
  return skillScores.filter((entry) => entry.score >= minScore);
}

function resolveActionTools(
  toolScores: { item: Tool; score: number }[],
  retrievalMethod: CapabilityRetrievalMethod,
  minScore: number,
): { item: Tool; score: number }[] {
  if (retrievalMethod === "llm") {
    return toolScores.filter(
      (entry) => !isMetaToolName(entry.item.name) && !isPlanningToolName(entry.item.name),
    );
  }
  return filterActionToolScores(toolScores, minScore);
}

function resolveRelevantSkills(
  skillScores: { item: Skill; score: number }[],
  retrievalMethod: CapabilityRetrievalMethod,
  minScore: number,
): { item: Skill; score: number }[] {
  if (retrievalMethod === "llm") {
    return skillScores;
  }
  return filterRelevantSkillScores(skillScores, minScore);
}

export function resolvePromptProfile(input: {
  userInput: string;
  toolScores: { item: Tool; score: number }[];
  skillScores: { item: Skill; score: number }[];
  retrievalMethod?: CapabilityRetrievalMethod;
  minScore?: number;
  singleSkillGap?: number;
}): { profile: PromptProfile; primarySkill?: Skill } {
  const retrievalMethod = input.retrievalMethod ?? "llm";
  const minScore = input.minScore ?? resolveMinCapabilityScore();
  const singleSkillGap = input.singleSkillGap ?? resolveSingleSkillScoreGap();

  const actionTools = resolveActionTools(input.toolScores, retrievalMethod, minScore);
  const relevantSkills = resolveRelevantSkills(input.skillScores, retrievalMethod, minScore);
  const skillNames = relevantSkills.map((entry) => entry.item.name);

  if (isPlanningIntent(input.userInput, skillNames)) {
    return {
      profile: "planning",
      primarySkill: relevantSkills[0]?.item,
    };
  }

  if (relevantSkills.length === 1) {
    return { profile: "single_skill", primarySkill: relevantSkills[0].item };
  }

  if (relevantSkills.length >= 2) {
    if (retrievalMethod === "llm") {
      return { profile: "multi_skill" };
    }
    const top = relevantSkills[0];
    const second = relevantSkills[1];
    if (top.score - second.score >= singleSkillGap) {
      return { profile: "single_skill", primarySkill: top.item };
    }
    return { profile: "multi_skill" };
  }

  if (actionTools.length > 0) {
    return { profile: "tooling" };
  }

  return { profile: "chat" };
}

function pickToolsForProfile(
  profile: PromptProfile,
  allTools: Tool[],
  retrievedToolScores: { item: Tool; score: number }[],
): Tool[] {
  const toolByName = new Map(allTools.map((tool) => [tool.name, tool]));
  const addByNames = (names: readonly string[]): Tool[] =>
    names
      .map((name) => toolByName.get(name))
      .filter((tool): tool is Tool => tool !== undefined);

  const actionTools = retrievedToolScores
    .map((entry) => entry.item)
    .filter((tool) => !isAlwaysOnToolName(tool.name));

  switch (profile) {
    case "chat":
      return addByNames(META_TOOL_NAMES);
    case "tooling":
      return [...addByNames(META_TOOL_NAMES), ...actionTools];
    case "single_skill":
    case "multi_skill":
      return [...addByNames(META_TOOL_NAMES), ...actionTools];
    case "planning":
      return [
        ...addByNames(META_TOOL_NAMES),
        ...addByNames(PLANNING_TOOL_NAMES),
        ...actionTools,
      ];
  }
}

function pickSkillsForProfile(
  profile: PromptProfile,
  retrievedSkills: Skill[],
  primarySkill?: Skill,
): Skill[] {
  switch (profile) {
    case "chat":
    case "tooling":
      return [];
    case "single_skill":
      return primarySkill ? [primarySkill] : retrievedSkills.slice(0, 1);
    case "multi_skill":
    case "planning":
      return retrievedSkills;
  }
}

function buildRegistries(tools: Tool[], skills: Skill[]): {
  toolRegistry: ToolRegistry;
  skillRegistry: SkillRegistry;
} {
  const toolRegistry = new ToolRegistry();
  for (const tool of tools) {
    toolRegistry.register(tool);
  }

  const skillRegistry = new SkillRegistry();
  for (const skill of skills) {
    skillRegistry.register(skill);
  }

  return { toolRegistry, skillRegistry };
}

export async function preprocessContext(
  params: ContextPreprocessParams,
): Promise<ContextRouteResult> {
  const retrievalMethod = resolveCapabilityRetrievalMethod(params.capabilityRetrievalMethod);
  const canRetrieve =
    retrievalMethod === "llm" || params.vectorManager !== undefined;

  // Long-term memory always uses embedding RAG (MemoryManager), independent of tool/skill method.
  const memoryPromise = params.memoryManager.searchLongTermMemory(params.userInput);

  let toolScores: { item: Tool; score: number }[] = [];
  let skillScores: { item: Skill; score: number }[] = [];
  let retrievedSkills: Skill[] = [];

  if (canRetrieve) {
    const capabilityResult = await retrieveCapabilities({
      method: retrievalMethod,
      userInput: params.userInput,
      llm: params.llm,
      vectorManager: params.vectorManager,
      allTools: params.allTools,
      allSkills: params.allSkills,
      toolLimit: params.toolLimit ?? DEFAULT_RETRIEVED_TOOL_LIMIT,
      skillLimit: params.skillLimit ?? DEFAULT_RETRIEVED_SKILL_LIMIT,
    });
    toolScores = capabilityResult.toolScores;
    skillScores = capabilityResult.skillScores;
    retrievedSkills = capabilityResult.skills;
  } else {
    logger.warn("Capability retrieval unavailable; using full catalog with planning profile.");
    return {
      profile: "planning",
      ...buildRegistries(params.allTools, params.allSkills),
      relevantLongTermMemory: await memoryPromise,
      retrievalMethod,
    };
  }

  const relevantLongTermMemory = await memoryPromise;

  const { profile, primarySkill } = resolvePromptProfile({
    userInput: params.userInput,
    toolScores,
    skillScores,
    retrievalMethod,
  });

  const tools = pickToolsForProfile(profile, params.allTools, toolScores);
  const skills = pickSkillsForProfile(profile, retrievedSkills, primarySkill);
  const { toolRegistry, skillRegistry } = buildRegistries(tools, skills);

  const primarySkillPrompt =
    profile === "single_skill" && primarySkill
      ? getSkillPromptMarkdown(primarySkill)
      : undefined;

  logger.info("Context router selected prompt profile", {
    profile,
    tools: toolRegistry.list().length,
    skills: skillRegistry.list().length,
    memoryHits: relevantLongTermMemory.length,
    primarySkill: primarySkill?.name,
    retrievalMethod,
  });

  return {
    profile,
    toolRegistry,
    skillRegistry,
    relevantLongTermMemory,
    primarySkill,
    primarySkillPrompt,
    retrievalMethod,
  };
}
