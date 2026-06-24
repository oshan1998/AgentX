import type { SkillRegistry, ToolRegistry } from "../../../../common/interfaces/registry.js";
import type { Soul, User } from "../../../../managers/profile-manager.js";
import type { PromptProfile } from "../../context-router.js";

export type AgentRole = "principal" | "sub_agent" | "bootstrap";

export interface StaticSectionContext {
  sessionId: string;
  soul: Soul;
  user: User;
  profile: PromptProfile;
  agentRole: AgentRole;
  toolRegistry: ToolRegistry;
  skillRegistry: SkillRegistry;
  primarySkillName?: string;
  primarySkillPrompt?: string;
  subAgentSystemPromptAppend?: string;
  /** Pre-computed schema enforcement block for action-policy inclusion. */
  schemaEnforcement: string;
}

export interface DynamicSectionContext {
  latestUserMessage: string;
  iteration: number;
  maxIterations: number;
  lastObservation?: string;
  recentMessages: string;
  memory: string;
  contextLabel: string;
  goalLabel: string;
}

export interface PromptSection<TContext> {
  id: string;
  when?: (ctx: TContext) => boolean;
  build: (ctx: TContext) => string;
}
