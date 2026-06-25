import type { SkillRegistry, ToolRegistry } from "../../../common/interfaces/registry.js";
import type { LongTermMemoryEntry, Message } from "../../../common/interfaces/types.js";
import type { Soul, User } from "../../../managers/profile-manager.js";

/** Maps to router route: simple → chat system prompt, complex → planning system prompt. */
export type PromptProfile = "chat" | "planning";

export interface StaticPromptInput {
  sessionId: string;
  soul: Soul;
  user: User;
  toolRegistry: ToolRegistry;
  skillRegistry: SkillRegistry;
  isSubAgent?: boolean;
  isBootstrapComplete: boolean;
  subAgentSystemPromptAppend?: string;
  promptProfile?: PromptProfile;
}

export interface DynamicPromptInput {
  latestUserMessage: string;
  messages: Message[];
  relevantLongTermMemory: LongTermMemoryEntry[];
  lastObservation?: string;
  iteration: number;
  maxIterations: number;
}
