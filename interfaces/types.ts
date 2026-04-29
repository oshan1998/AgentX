export type DecisionType = "respond" | "tool_call" | "skill_call" | "memory_write" | "profile_write";

export interface AgentDecision {
  type: DecisionType;
  message?: string;
  tool?: string;
  skill?: string;
  input?: Record<string, unknown>;
  memoryEntry?: Omit<LongTermMemoryEntry, "id" | "createdAt">;
  target?: "soul" | "user";
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
}

export interface SkillContext {
  sessionId: string;
  runTool: (name: string, input: Record<string, unknown>) => Promise<unknown>;
  searchMemory: (query: string) => Promise<LongTermMemoryEntry[]>;
  writeMemory: (entry: Omit<LongTermMemoryEntry, "id" | "createdAt">) => Promise<LongTermMemoryEntry>;
  writeProfile: (target: "soul" | "user", content: Record<string, unknown>) => Promise<unknown>;
}

export interface Tool {
  name: string;
  description: string;
  run(input: Record<string, unknown>, context: ToolContext): Promise<unknown>;
}

export interface Skill {
  name: string;
  description: string;
  run(input: Record<string, unknown>, context: SkillContext): Promise<unknown>;
}

export interface LlmAdapter {
  decide(prompt: string, systemPrompt?: string): Promise<AgentDecision>;
  complete(prompt: string, systemPrompt?: string): Promise<string>;
}
