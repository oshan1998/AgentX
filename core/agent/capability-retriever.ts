import type { LlmAdapter, Skill, Tool } from "../../common/interfaces/types.js";
import { VectorManager } from "../../managers/vector-manager.js";
import { logger } from "../../common/services/logger.js";

export type CapabilityRetrievalMethod = "rag" | "llm";

/** Tools always included in the dynamic prompt regardless of retrieval method. */
export const ALWAYS_ON_TOOL_NAMES = [
  "get_capability_schema",
  "list_capabilities",
  "ask_user",
  "delegate_sub_agent",
  "orchestrate_task_graph",
  "read_task_plan",
  "write_task_plan",
  "patch_task_plan_task",
] as const;

export const DEFAULT_RETRIEVED_TOOL_LIMIT = 8;
export const DEFAULT_RETRIEVED_SKILL_LIMIT = 4;

export function resolveCapabilityRetrievalMethod(
  override?: CapabilityRetrievalMethod,
): CapabilityRetrievalMethod {
  if (override) return override;
  const raw = process.env.CAPABILITY_RETRIEVAL_METHOD?.trim().toLowerCase();
  return raw === "llm" ? "llm" : "rag";
}

export interface RetrieveCapabilitiesParams {
  method: CapabilityRetrievalMethod;
  userInput: string;
  llm: LlmAdapter;
  vectorManager?: VectorManager;
  allTools: Tool[];
  allSkills: Skill[];
  toolLimit?: number;
  skillLimit?: number;
}

export interface RetrieveCapabilitiesResult {
  tools: Tool[];
  skills: Skill[];
  method: CapabilityRetrievalMethod;
}

export async function retrieveCapabilities(
  params: RetrieveCapabilitiesParams,
): Promise<RetrieveCapabilitiesResult> {
  const toolLimit = params.toolLimit ?? DEFAULT_RETRIEVED_TOOL_LIMIT;
  const skillLimit = params.skillLimit ?? DEFAULT_RETRIEVED_SKILL_LIMIT;

  let retrievedTools: Tool[];
  let retrievedSkills: Skill[];
  let effectiveMethod = params.method;

  if (params.method === "llm") {
    try {
      const llmResult = await retrieveViaLlm(
        params.llm,
        params.userInput,
        params.allTools,
        params.allSkills,
        toolLimit,
        skillLimit,
      );
      retrievedTools = llmResult.tools;
      retrievedSkills = llmResult.skills;
    } catch (err) {
      logger.warn("LLM capability retrieval failed; falling back to RAG.", { error: err });
      if (!params.vectorManager) throw err;
      effectiveMethod = "rag";
      const ragResult = await retrieveViaRag(
        params.vectorManager,
        params.userInput,
        params.allTools,
        params.allSkills,
        toolLimit,
        skillLimit,
      );
      retrievedTools = ragResult.tools;
      retrievedSkills = ragResult.skills;
    }
  } else {
    if (!params.vectorManager) {
      throw new Error("RAG capability retrieval requires VectorManager.");
    }
    const ragResult = await retrieveViaRag(
      params.vectorManager,
      params.userInput,
      params.allTools,
      params.allSkills,
      toolLimit,
      skillLimit,
    );
    retrievedTools = ragResult.tools;
    retrievedSkills = ragResult.skills;
  }

  const alwaysOn = new Set<string>(ALWAYS_ON_TOOL_NAMES);
  const toolByName = new Map(params.allTools.map((t) => [t.name, t]));
  const mergedTools: Tool[] = [];

  for (const name of alwaysOn) {
    const tool = toolByName.get(name);
    if (tool) mergedTools.push(tool);
  }
  for (const tool of retrievedTools) {
    if (!alwaysOn.has(tool.name)) {
      mergedTools.push(tool);
    }
  }

  return {
    tools: mergedTools,
    skills: retrievedSkills,
    method: effectiveMethod,
  };
}

async function retrieveViaRag(
  vectorManager: VectorManager,
  userInput: string,
  allTools: Tool[],
  allSkills: Skill[],
  toolLimit: number,
  skillLimit: number,
): Promise<{ tools: Tool[]; skills: Skill[] }> {
  const queryEmbedding = await vectorManager.getEmbedding(userInput);
  return {
    tools: vectorManager.searchTools(queryEmbedding, allTools, toolLimit),
    skills: vectorManager.searchSkills(queryEmbedding, allSkills, skillLimit),
  };
}

async function retrieveViaLlm(
  llm: LlmAdapter,
  userInput: string,
  allTools: Tool[],
  allSkills: Skill[],
  toolLimit: number,
  skillLimit: number,
): Promise<{ tools: Tool[]; skills: Skill[] }> {
  const toolLines = allTools
    .map((t) => `- ${t.name}: ${t.description}`)
    .join("\n");
  const skillLines = allSkills
    .map((s) => `- ${s.name}: ${s.description}`)
    .join("\n");

  const systemPrompt = [
    "You select which tools and skills are relevant for a user task.",
    `Pick up to ${toolLimit} tools and up to ${skillLimit} skills from the catalog.`,
    "Use exact names from the catalog. Prefer fewer, highly relevant items over broad coverage.",
    'Reply with ONLY valid JSON: {"tool_names":["..."],"skill_names":["..."]}',
    "If nothing beyond meta/planning tools is needed, return empty arrays.",
  ].join(" ");

  const prompt = [
    `User request:\n${userInput}`,
    `\nTools:\n${toolLines}`,
    `\nSkills:\n${skillLines}`,
  ].join("\n");

  const raw = await llm.complete(prompt, systemPrompt);
  const parsed = parseLooseJson(raw, "Capability selection response") as {
    tool_names?: unknown;
    skill_names?: unknown;
  };

  const toolNames = normalizeNameList(parsed.tool_names);
  const skillNames = normalizeNameList(parsed.skill_names);

  const toolByName = new Map(allTools.map((t) => [t.name, t]));
  const skillByName = new Map(allSkills.map((s) => [s.name, s]));

  const tools = toolNames
    .slice(0, toolLimit)
    .map((name) => toolByName.get(name))
    .filter((t): t is Tool => t !== undefined);

  const skills = skillNames
    .slice(0, skillLimit)
    .map((name) => skillByName.get(name))
    .filter((s): s is Skill => s !== undefined);

  const unknownTools = toolNames.filter((n) => !toolByName.has(n));
  const unknownSkills = skillNames.filter((n) => !skillByName.has(n));
  if (unknownTools.length > 0 || unknownSkills.length > 0) {
    logger.debug("LLM capability selection included unknown names", {
      unknownTools,
      unknownSkills,
    });
  }

  return { tools, skills };
}

function normalizeNameList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function parseLooseJson(raw: string, contextLabel: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first === -1 || last === -1 || last <= first) {
      throw new Error(`${contextLabel} was not valid JSON: ${trimmed.slice(0, 200)}`);
    }
    try {
      return JSON.parse(trimmed.slice(first, last + 1));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`${contextLabel} JSON parse failed: ${msg}`);
    }
  }
}
