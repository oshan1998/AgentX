import { SkillRegistry, ToolRegistry } from "../../common/interfaces/registry.js";
import type { LlmAdapter, SessionMemory } from "../../common/interfaces/types.js";
import { MemoryManager } from "../../managers/memory-manager.js";
import type { Soul, User } from "../../managers/profile-manager.js";
import { ProfileManager } from "../../managers/profile-manager.js";
import type { VectorManager } from "../../managers/vector-manager.js";
import { logger } from "../../common/services/logger.js";
import type { CapabilityRetrievalMethod } from "./capability-retriever.js";
import { preprocessContext, type ContextRouteResult } from "./context-router.js";
import { PromptBuilder } from "./prompt-builder.js";
import { Router, type RouteResult } from "./router/index.js";

/** Run-scoped prompt state: static system prompt and in-memory session mirror. */
export interface RunPromptContext {
  sessionId: string;
  session: SessionMemory;
  userInput: string;
  isSubAgent: boolean;
  isBootstrapComplete: boolean;
  soul: Soul;
  user: User;
  staticSystemPrompt: string;
  subAgentSystemPromptAppend?: string;
  contextRoute?: ContextRouteResult;
  routeResult?: RouteResult;
}

export interface RunContextPipelineDeps {
  llm: LlmAdapter;
  memoryManager: MemoryManager;
  profileManager: ProfileManager;
  toolRegistry: ToolRegistry;
  skillRegistry: SkillRegistry;
  vectorManager?: VectorManager;
  capabilityRetrievalMethod?: CapabilityRetrievalMethod;
}

export interface BuildRunPromptContextInput {
  sessionId: string;
  userInput: string;
  isSubAgent: boolean;
  subAgentSystemPromptAppend?: string;
}

const promptBuilder = new PromptBuilder();
const router = new Router();

/**
 * Assembles run-scoped context for the agent loop: loads session/profile state,
 * optionally routes capabilities via context-router, and builds the static system prompt.
 */
export async function buildRunPromptContext(
  deps: RunContextPipelineDeps,
  input: BuildRunPromptContextInput,
): Promise<RunPromptContext> {
  const { sessionId, userInput, isSubAgent } = input;

  const session = await deps.memoryManager.getSession(sessionId);
  const allMemory = await deps.memoryManager.getLongTermMemory();
  const soul = await deps.profileManager.getSoul();
  const user = await deps.profileManager.getUser();

  const isBootstrapComplete = isSubAgent
    ? true
    : allMemory.some((m) => m.content === "bootstrap_complete");

  const subAgentSystemPromptAppend = isSubAgent
    ? input.subAgentSystemPromptAppend
    : undefined;

  let activeToolRegistry = deps.toolRegistry;
  let activeSkillRegistry = deps.skillRegistry;
  let contextRoute: ContextRouteResult | undefined;
  let routeResult: RouteResult | undefined;
  let promptProfile: ContextRouteResult["profile"] | undefined;
  let primarySkillName: string | undefined;
  let primarySkillPrompt: string | undefined;
  let initialLongTermMemory: ContextRouteResult["relevantLongTermMemory"] | undefined;

  if (!isSubAgent) {
    try {
      routeResult = await router.route(
        {
          sessionId,
          userInput,
          isSubAgent,
          isBootstrapComplete,
          subAgentSystemPromptAppend,
        },
        {
          llm: deps.llm,
          memoryManager: deps.memoryManager,
          profileManager: deps.profileManager,
          toolRegistry: deps.toolRegistry,
          skillRegistry: deps.skillRegistry,
          vectorManager: deps.vectorManager,
          capabilityRetrievalMethod: deps.capabilityRetrievalMethod,
        },
      );
    } catch (err) {
      logger.error("Router failed. Continuing without route context.", { error: err });
    }
  }

  if (!isSubAgent && isBootstrapComplete) {
    try {
      contextRoute = await preprocessContext({
        userInput,
        llm: deps.llm,
        memoryManager: deps.memoryManager,
        allTools: deps.toolRegistry.list(),
        allSkills: deps.skillRegistry.list(),
        vectorManager: deps.vectorManager,
        capabilityRetrievalMethod: deps.capabilityRetrievalMethod,
      });
      activeToolRegistry = contextRoute.toolRegistry;
      activeSkillRegistry = contextRoute.skillRegistry;
      promptProfile = contextRoute.profile;
      primarySkillName = contextRoute.primarySkill?.name;
      primarySkillPrompt = contextRoute.primarySkillPrompt;
      initialLongTermMemory = contextRoute.relevantLongTermMemory;
    } catch (err) {
      logger.error(
        "Context preprocessing failed. Falling back to full registry.",
        { error: err },
      );
    }
  }

  const staticSystemPrompt = promptBuilder.buildStaticSystem({
    sessionId,
    soul,
    user,
    toolRegistry: activeToolRegistry,
    skillRegistry: activeSkillRegistry,
    isSubAgent,
    isBootstrapComplete,
    subAgentSystemPromptAppend,
    promptProfile,
    primarySkillName,
    primarySkillPrompt,
  });

  logger.debug("Built static system prompt for run", {
    sessionId,
    staticPromptChars: staticSystemPrompt.length,
    promptProfile: promptProfile ?? "default",
  });

  return {
    sessionId,
    session,
    userInput,
    isSubAgent,
    isBootstrapComplete,
    soul,
    user,
    staticSystemPrompt,
    subAgentSystemPromptAppend,
    contextRoute: contextRoute
      ? {
          ...contextRoute,
          relevantLongTermMemory:
            initialLongTermMemory ?? contextRoute.relevantLongTermMemory,
        }
      : undefined,
    routeResult,
  };
}
