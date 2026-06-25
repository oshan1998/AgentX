import type { SkillRegistry, ToolRegistry } from "../../../common/interfaces/registry.js";
import type { LongTermMemoryEntry, LlmAdapter, Message, Skill, Tool } from "../../../common/interfaces/types.js";
import type { MemoryManager } from "../../../managers/memory-manager.js";
import type { ProfileManager } from "../../../managers/profile-manager.js";
import type { Scored, VectorManager } from "../../../managers/vector-manager.js";
import type { VertexRagManager } from "../../../managers/vertex-rag-manager.js";
import type { CapabilityRetrievalMethod } from "../capability-retriever.js";

export type QueryComplexity = "simple" | "complex";

export type RoutePath = QueryComplexity;

export interface RouteInput {
  sessionId: string;
  userInput: string;
  isSubAgent: boolean;
  isBootstrapComplete: boolean;
  subAgentSystemPromptAppend?: string;
  /** Conversation messages from prior turns (excludes the current user message). */
  sessionMessages?: Message[];
}

export interface RouterDeps {
  llm: LlmAdapter;
  memoryManager: MemoryManager;
  profileManager: ProfileManager;
  toolRegistry: ToolRegistry;
  skillRegistry: SkillRegistry;
  vectorManager?: VectorManager;
  vertexRagManager?: VertexRagManager;
  capabilityRetrievalMethod?: CapabilityRetrievalMethod;
}

export interface NodeTraceEntry {
  nodeId: string;
  startedAt: number;
  durationMs: number;
  status: "ok" | "skipped" | "failed";
  error?: string;
}

/**
 * Mutable context bag passed through every routed node.
 * Nodes read prior fields and write their own slice.
 */
export interface RouteContext {
  readonly input: RouteInput;
  queryComplexity?: QueryComplexity;
  /** Terminal route branch that ran (simple or complex). */
  selectedRoute?: RoutePath;
  /** Final user prompt — set by assemble-system-prompt. */
  routedUserPrompt?: string;
  /** Final system prompt — essential sections + routed context from assemble-system-prompt. */
  routedSystemPrompt?: string;
  toolScores?: Scored<Tool>[];
  skillScores?: Scored<Skill>[];
  relevantLongTermMemory?: LongTermMemoryEntry[];
  trace: NodeTraceEntry[];
}

export interface RouteResult {
  context: RouteContext;
}
