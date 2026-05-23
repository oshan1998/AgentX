import { SkillRegistry, ToolRegistry } from "../../common/interfaces/registry.js";
import type { Tool } from "../../common/interfaces/types.js";
import { DELEGATE_SUB_AGENT_TOOL_NAME } from "./agent-runtime-constants.js";

export function cloneToolWhitelist(
  master: ToolRegistry,
  requestedNames: string[],
): ToolRegistry {
  const out = new ToolRegistry();
  for (const raw of requestedNames) {
    const name = typeof raw === "string" ? raw.trim() : "";
    if (!name || name === DELEGATE_SUB_AGENT_TOOL_NAME) {
      continue;
    }
    const t = master.get(name);
    if (t) out.register(t);
  }
  return out;
}

export function cloneSkillWhitelist(
  master: SkillRegistry,
  requestedNames: string[],
): SkillRegistry {
  const out = new SkillRegistry();
  for (const raw of requestedNames) {
    const name = typeof raw === "string" ? raw.trim() : "";
    if (!name) continue;
    const s = master.get(name);
    if (s) out.register(s);
  }
  return out;
}

export function registerDelegateToolOnce(
  registry: ToolRegistry,
  tool: Tool,
): void {
  if (!registry.get(tool.name)) registry.register(tool);
}
