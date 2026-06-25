import { SkillRegistry, ToolRegistry } from "../../common/interfaces/registry.js";
import type { LlmAdapter, SessionMemory } from "../../common/interfaces/types.js";
import { MemoryManager } from "../../managers/memory-manager.js";
import type { Soul, User } from "../../managers/profile-manager.js";
import { ProfileManager } from "../../managers/profile-manager.js";
import type { VectorManager } from "../../managers/vector-manager.js";
import { logger } from "../../common/services/logger.js";
import type { CapabilityRetrievalMethod } from "./capability-retriever.js";
import {
  buildBootstrapSystemPrompt,
  buildSubAgentSystemPrompt,
} from "./prompt-builder/index.js";
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

const router = new Router();

/**
 * Loads session/profile state and resolves prompts for the agent loop.
 *
 * Routing:
 *   - Sub-agent         → sub-agent static assembler (system prompt built once)
 *   - Bootstrap         → bootstrap static assembler (system prompt built once)
 *   - Main post-bootstrap → router DAG (intent classify + memory + capability select)
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

  const subAgentSystemPromptAppend = isSubAgent ? input.subAgentSystemPromptAppend : undefined;

  // ── Sub-agent ─────────────────────────────────────────────────────────────
  if (isSubAgent) {
    const systemPrompt = buildSubAgentSystemPrompt({
      sessionId,
      soul,
      user,
      toolRegistry: deps.toolRegistry,
      skillRegistry: deps.skillRegistry,
      isSubAgent: true,
      isBootstrapComplete: true,
      subAgentSystemPromptAppend,
      promptProfile: "planning",
    });

    logger.debug("Resolved sub-agent prompts", { sessionId, systemPromptChars: systemPrompt.length });

    return {
      sessionId,
      session,
      userInput,
      isSubAgent: true,
      isBootstrapComplete: true,
      soul,
      user,
      systemPrompt,
      userPrompt: userInput,
      subAgentSystemPromptAppend,
    };
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  if (!isBootstrapComplete) {
    const systemPrompt = buildBootstrapSystemPrompt({
      sessionId,
      soul,
      user,
      toolRegistry: deps.toolRegistry,
      skillRegistry: deps.skillRegistry,
      isSubAgent: false,
      isBootstrapComplete: false,
      promptProfile: "chat",
    });

    logger.debug("Resolved bootstrap prompts", { sessionId, systemPromptChars: systemPrompt.length });

    return {
      sessionId,
      session,
      userInput,
      isSubAgent: false,
      isBootstrapComplete: false,
      soul,
      user,
      systemPrompt,
      userPrompt: userInput,
    };
  }

  // ── Main agent, post-bootstrap → router ───────────────────────────────────
  const routeResult = await router.route(
    {
      sessionId,
      userInput,
      isSubAgent: false,
      isBootstrapComplete: true,
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

  if (!routeCtx.routedSystemPrompt) {
    throw new Error(`[run-context-pipeline] Router completed but produced no system prompt (session=${sessionId})`);
  }

  logger.debug("Resolved routed prompts", {
    sessionId,
    selectedRoute: routeCtx.selectedRoute,
    systemPromptChars: routeCtx.routedSystemPrompt.length,
    userPromptChars: (routeCtx.routedUserPrompt ?? userInput).length,
  });

  return {
    sessionId,
    session,
    userInput,
    isSubAgent: false,
    isBootstrapComplete: true,
    soul,
    user,
    systemPrompt: routeCtx.routedSystemPrompt,
    userPrompt: routeCtx.routedUserPrompt ?? userInput,
    routeResult,
  };
}
