import { selectMessagesForPrompt } from "../../../common/services/prompt-truncation.js";
import { resolvePromptMode } from "./resolve-prompt-mode.js";
import { BootstrapStrategy } from "./strategies/bootstrap-strategy.js";
import { MainStrategy } from "./strategies/main-strategy.js";
import { SubAgentStrategy } from "./strategies/sub-agent-strategy.js";
import type {
  DynamicPromptInput,
  PromptMode,
  PromptStrategy,
  StaticPromptInput,
} from "./types.js";

export class PromptBuilder {
  private readonly strategies: Record<PromptMode, PromptStrategy> = {
    bootstrap: new BootstrapStrategy(),
    main: new MainStrategy(),
    sub_agent: new SubAgentStrategy(),
  };

  resolveMode(input: StaticPromptInput): PromptMode {
    return resolvePromptMode(input);
  }

  buildStaticSystem(input: StaticPromptInput): string {
    const mode = resolvePromptMode(input);
    return this.strategies[mode].buildStatic(input);
  }

  buildDynamicUser(input: DynamicPromptInput): string {
    const mode = resolvePromptMode(input);
    const recentMessages = selectMessagesForPrompt(input.messages, {
      lastObservation: input.lastObservation,
    });
    return this.strategies[mode].buildDynamic(input, recentMessages);
  }
}
