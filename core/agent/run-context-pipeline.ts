import { SkillRegistry, ToolRegistry } from "../../common/interfaces/registry.js";
import type { LlmAdapter, SessionMemory } from "../../common/interfaces/types.js";
import { MemoryManager } from "../../managers/memory-manager.js";
import type { Soul, User } from "../../managers/profile-manager.js";
import { ProfileManager } from "../../managers/profile-manager.js";
import type { VectorManager } from "../../managers/vector-manager.js";
import { logger } from "../../common/services/logger.js";
import type { CapabilityRetrievalMethod } from "./capability-retriever.js";
import { PromptBuilder } from "./prompt-builder.js";
import { Router, type RouteResult } from "./router/index.js";

/** Run-scoped state for a single agent turn. */
export interface RunPromptContext {
  sessionId: string;
  session: SessionMemory;
  userInput: string;
  isSubAgent: boolean;
  isBootstrapComplete: boolean;
  soul: Soul;
  user: User;
  systemPrompt: string;
  userPrompt: string;
  /** True when prompts came from the router terminal node. */
  usesRouterPrompts: boolean;
  subAgentSystemPromptAppend?: string;
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
 * Loads session/profile state and resolves prompts for the agent loop.
 * Main-agent post-bootstrap runs use router output (system = dynamic context, user = query).
 * Bootstrap and sub-agent runs still use PromptBuilder.
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

  let routeResult: RouteResult | undefined;
  let usesRouterPrompts = false;
  let systemPrompt = "";
  let userPrompt = userInput;

  const shouldRoute = !isSubAgent && isBootstrapComplete;

  if (shouldRoute) {
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

      const routeCtx = routeResult.context;
      if (routeCtx.selectedRoute && routeCtx.routedSystemPrompt != null) {
        usesRouterPrompts = true;
        systemPrompt = routeCtx.routedSystemPrompt;
        userPrompt = routeCtx.routedUserPrompt ?? userInput;
      }
    } catch (err) {
      logger.error("Router failed. Falling back to prompt builder.", { error: err });
    }
  }

  if (!usesRouterPrompts) {
    systemPrompt = promptBuilder.buildStaticSystem({
      sessionId,
      soul,
      user,
      toolRegistry: deps.toolRegistry,
      skillRegistry: deps.skillRegistry,
      isSubAgent,
      isBootstrapComplete,
      subAgentSystemPromptAppend,
    });
    userPrompt = userInput;
  }

  logger.debug("Resolved run prompts", {
    sessionId,
    usesRouterPrompts,
    selectedRoute: routeResult?.context.selectedRoute,
    systemPromptChars: systemPrompt.length,
    userPromptChars: userPrompt.length,
  });

  return {
    sessionId,
    session,
    userInput,
    isSubAgent,
    isBootstrapComplete,
    soul,
    user,
    systemPrompt,
    userPrompt,
    usesRouterPrompts,
    subAgentSystemPromptAppend,
    routeResult,
  };
}
