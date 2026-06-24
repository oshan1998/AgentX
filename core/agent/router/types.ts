import type { SkillRegistry, ToolRegistry } from "../../../common/interfaces/registry.js";
import type { LongTermMemoryEntry, LlmAdapter, Skill, Tool } from "../../../common/interfaces/types.js";
import type { MemoryManager } from "../../../managers/memory-manager.js";
import type { ProfileManager } from "../../../managers/profile-manager.js";
import type { Scored, VectorManager } from "../../../managers/vector-manager.js";
import type { CapabilityRetrievalMethod } from "../capability-retriever.js";

export type UserIntent =
  | "conversation"
  | "tool_action"
  | "single_skill"
  | "multi_skill"
  | "planning"
  | "unknown";

export interface IntentResult {
  label: UserIntent;
  confidence?: number;
  signals?: string[];
}

export interface RouteInput {
  sessionId: string;
  userInput: string;
  isSubAgent: boolean;
  isBootstrapComplete: boolean;
  subAgentSystemPromptAppend?: string;
}

export interface RouterDeps {
  llm: LlmAdapter;
  memoryManager: MemoryManager;
  profileManager: ProfileManager;
  toolRegistry: ToolRegistry;
  skillRegistry: SkillRegistry;
  vectorManager?: VectorManager;
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
  intent?: IntentResult;
  toolScores?: Scored<Tool>[];
  skillScores?: Scored<Skill>[];
  relevantLongTermMemory?: LongTermMemoryEntry[];
  trace: NodeTraceEntry[];
}

export interface RouteResult {
  context: RouteContext;
}
