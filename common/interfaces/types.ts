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

/** Parameters for nested sub-agent runs (agentic skills and delegate tool). */
export interface DelegateSubAgentParams {
  task: string;
  toolNames?: string[];
  skillNames?: string[];
  /** Appended after the standard delegated-specialist system prompt (e.g. skill `prompt.md`). */
  systemPromptAppend?: string;
  maxIterations?: number;
  deadlineMs?: number;
  model?: string;
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

export interface LlmImageInput {
  mimeType: string;
  dataBase64: string;
}

export interface LlmAdapter {
  decide(prompt: string, systemPrompt?: string): Promise<AgentDecision>;
  complete(prompt: string, systemPrompt?: string): Promise<string>;
  completeWithImage(prompt: string, image: LlmImageInput): Promise<string>;
}

export type PersonGenerationSetting = "allow_all" | "allow_adult" | "dont_allow";

export interface ImageGenInput {
  prompt: string;
  aspectRatio?: string;
  numberOfImages?: number;
  /** Person-generation safety setting. Defaults from IMAGEN_PERSON_GENERATION env (allow_all). */
  personGeneration?: PersonGenerationSetting;
}

export type ImageEditMode =
  | "default"
  | "inpaint_insert"
  | "inpaint_remove"
  | "outpaint"
  | "background_swap"
  | "style"
  | "upscale";

export interface ImageEditInput {
  /** Text instruction for the edit. Required for all modes except upscale. */
  prompt?: string;
  /** Edit strategy. Default: general enhancement/edit (`default`). Use `upscale` for resolution upscaling. */
  mode?: ImageEditMode;
  sourceImage: Buffer;
  sourceMimeType: string;
  /** Optional mask image for inpaint/outpaint modes (white = edit region). */
  maskImage?: Buffer;
  maskMimeType?: string;
  aspectRatio?: string;
  negativePrompt?: string;
  /** Upscale factor when mode is upscale. Default x2. */
  upscaleFactor?: "x2" | "x4";
  /** Person-generation safety setting. Defaults from IMAGEN_PERSON_GENERATION env (allow_all). */
  personGeneration?: PersonGenerationSetting;
}

export interface ImageGenResult {
  buffer: Buffer;
  mimeType: string;
  provider: string;
  model: string;
  raiFilteredReason?: string;
}

export interface ImageGenAdapter {
  readonly provider: string;
  readonly model: string;
  generateImage(input: ImageGenInput): Promise<ImageGenResult>;
  editImage(input: ImageEditInput): Promise<ImageGenResult>;
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
