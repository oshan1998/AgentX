import type { SkillRegistry, ToolRegistry } from "../../../common/interfaces/registry.js";
import type { LongTermMemoryEntry, SessionMemory } from "../../../common/interfaces/types.js";
import type { Soul, User } from "../../../managers/profile-manager.js";

export type { Soul, User };

export interface PromptBuilderInput {
  latestUserMessage: string;
  session: SessionMemory;
  relevantLongTermMemory: LongTermMemoryEntry[];
  toolRegistry: ToolRegistry;
  skillRegistry: SkillRegistry;
  lastObservation?: string;
  iteration: number;
  maxIterations: number;
  isBootstrapComplete: boolean;
  soul: Soul;
  user: User;
  isSubAgent?: boolean;
  subAgentSystemPromptAppend?: string;
}

export interface BuiltPrompt {
  systemPrompt: string;
  userPrompt: string;
}
