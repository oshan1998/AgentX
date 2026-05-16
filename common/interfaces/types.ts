import { MemoryManager } from "../../managers/memory-manager.js";
import { ProfileManager } from "../../managers/profile-manager.js";
import { SessionTraceHub } from "../realtime/session-trace-hub.js";
import { SkillRegistry, ToolRegistry } from "./registry.js";

export enum DecisionType {
  Respond = "respond",
  ToolCall = "tool_call",
  SkillCall = "skill_call",
  MemoryWrite = "memory_write",
  ProfileWrite = "profile_write",
}

export enum SkillType{
  Agentic = "agentic",
  Workflow = "workflow",
}

export enum ProfileTarget {
  Soul = "soul",
  User = "user",
}

export interface AgentDecision {
  thought: string;
  type: DecisionType;
  message?: string;
  tool?: string;
  skill?: string;
  input?: Record<string, unknown>;
  memoryEntry?: Omit<LongTermMemoryEntry, "id" | "createdAt">;
  target?: ProfileTarget;
  content?: Record<string, unknown>;
}

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  meta?: Record<string, unknown>;
  createdAt: string;
}

export interface SessionMemory {
  sessionId: string;
  /** Principal session when this one was created for an isolated sub-agent run. */
  parentSessionId?: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
}

export type LongTermMemoryType = "user_preference" | "behavior_rule" | "fact";

export interface LongTermMemoryEntry {
  id: string;
  type: LongTermMemoryType;
  content: string;
  sourceSessionId: string;
  createdAt: string;
}

export interface ToolContext {
  sessionId: string;
  /** Host run id (tracing / delegation linkage). */
  runId?: string;
  abortSignal?: AbortSignal;
}

/** Dependencies provided to tools at instantiation time by ToolManager. */
export interface ToolDependencies {
  memoryManager: MemoryManager;
  llm?: LlmAdapter;
  profileManager?: ProfileManager;
  toolRegistry?: ToolRegistry;
  skillRegistry?: SkillRegistry;
  sessionTraceHub?: SessionTraceHub;
}

/** Parameters for nested sub-agent runs (agentic skills and delegate tool). */
export interface DelegateSubAgentParams {
  task: string;
  toolNames?: string[];
  skillNames?: string[];
  /** Appended after the standard delegated-specialist system prompt (e.g. skill `prompt.md`). */
  systemPromptAppend?: string;
  maxIterations?: number;
  deadlineMs?: number;
}

/** Injected into Executor so agentic skills can spawn a sub-agent with allow-listed tools. */
export type SkillDelegateRunner = (
  sessionId: string,
  tcx: ToolContext,
  params: DelegateSubAgentParams,
) => Promise<unknown>;

/** JSON Schema–style shape for planner-visible tool/skill inputs (typically type "object", properties, required). */
export type JsonInputSchema = Record<string, unknown>;

export interface SkillContext {
  sessionId: string;
  abortSignal?: AbortSignal;
  runTool: (name: string, input: Record<string, unknown>) => Promise<unknown>;
  searchMemory: (query: string) => Promise<LongTermMemoryEntry[]>;
  writeMemory: (entry: Omit<LongTermMemoryEntry, "id" | "createdAt">) => Promise<LongTermMemoryEntry>;
  writeProfile: (target: "soul" | "user", content: Record<string, unknown>) => Promise<unknown>;
  /** When set (principal runtime), agentic skills use this to run an isolated sub-loop with skill-defined tools and prompt.md. */
  delegateSubAgent?: (params: DelegateSubAgentParams) => Promise<unknown>;
}

export interface Tool {
  name: string;
  description: string;
  /** When set, appended to the system prompt so the model knows valid tool_call.input. */
  inputSchema?: JsonInputSchema;
  run(input: Record<string, unknown>, context: ToolContext): Promise<unknown>;
}

export interface Skill {
  name: string;
  description: string;
  /** When set, appended to the system prompt so the model knows valid skill_call.input. */
  inputSchema?: JsonInputSchema;
  /**
   * How the skill executes: step runner vs delegated sub-agent.
   * Shown in catalog as [workflow] or [agentic]. Omit = treat as workflow in prompts.
   */
  kind?: SkillType;
  run(input: Record<string, unknown>, context: SkillContext): Promise<unknown>;
}

export interface LlmAdapter {
  decide(prompt: string, systemPrompt?: string): Promise<AgentDecision>;
  complete(prompt: string, systemPrompt?: string): Promise<string>;
}

export enum SkillStepType {
  ToolCall = "tool_call",
  Llm = "llm",
  MemoryWrite = "memory_write",
  Respond = "respond",
  ProfileWrite = "profile_write",
}
export type SkillStep =
  | {
      type: SkillStepType.ToolCall;
      tool: string;
      input?: Record<string, unknown>;
      saveAs?: string;
    }
  | {
      type: SkillStepType.Llm;
      promptTemplate: string;
      saveAs?: string;
      /** When true, parse the model reply as JSON (with loose extraction if wrapped in prose). Enables {{saveAs.field}} templates. */
      parseOutputAsJson?: boolean;
    }
  | {
      type: SkillStepType.MemoryWrite;
      memoryType?: LongTermMemoryType;
      memoryTypeTemplate?: string;
      contentTemplate: string;
    }
  | {
      type: SkillStepType.Respond;
      messageTemplate: string;
    }
  | {
      type: SkillStepType.ProfileWrite;
      target: ProfileTarget;
      contentTemplate: string;
    };
