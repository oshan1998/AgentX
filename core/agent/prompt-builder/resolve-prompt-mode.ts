import type { PromptMode, StaticPromptInput } from "./types.js";

export function resolvePromptMode(
  input: Pick<StaticPromptInput, "isSubAgent" | "isBootstrapComplete">,
): PromptMode {
  if (!input.isSubAgent && !input.isBootstrapComplete) {
    return "bootstrap";
  }
  if (input.isSubAgent) {
    return "sub_agent";
  }
  return "main";
}
