import type { SkillRegistry, ToolRegistry } from "../../../common/interfaces/registry.js";
import type { LongTermMemoryEntry, Message } from "../../../common/interfaces/types.js";
import type { Soul, User } from "../../../managers/profile-manager.js";

export type PromptMode = "bootstrap" | "main" | "sub_agent";

export interface StaticPromptInput {
  sessionId: string;
  soul: Soul;
  user: User;
  toolRegistry: ToolRegistry;
  skillRegistry: SkillRegistry;
  isSubAgent?: boolean;
  isBootstrapComplete: boolean;
  subAgentSystemPromptAppend?: string;
}

export interface DynamicPromptInput {
  latestUserMessage: string;
  messages: Message[];
  relevantLongTermMemory: LongTermMemoryEntry[];
  lastObservation?: string;
  iteration: number;
  maxIterations: number;
  isSubAgent?: boolean;
  isBootstrapComplete: boolean;
}

export interface PromptStrategy {
  buildStatic(input: StaticPromptInput): string;
  buildDynamic(input: DynamicPromptInput, recentMessages: string): string;
}
