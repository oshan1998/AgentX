import { SkillRegistry, ToolRegistry } from "../../../common/interfaces/registry.js";
import { isMetaToolName, isAlwaysOnToolName } from "../capability-retriever.js";
import type { PromptProfile } from "../prompt-builder/types.js";
import { composeSections } from "../prompt-builder/compose.js";
import { toStaticSectionContext } from "../prompt-builder/section-context.js";
import { buildRoutedDynamicContext } from "./route-prompt.js";
import { routedComplexSections, routedCoreSections } from "./routed-prompt-recipes.js";
import type { RouterDeps, RouteContext, RoutePath } from "./types.js";

/** Top-N non-always-on tools injected into the simple route prompt. */
const SIMPLE_ROUTE_ACTION_TOOL_LIMIT = 3;

function resolveRoutedProfile(route: RoutePath): PromptProfile {
  return route === "simple" ? "chat" : "planning";
}

function buildCapabilityRegistries(
  ctx: RouteContext,
  deps: RouterDeps,
  route: RoutePath,
): { toolRegistry: ToolRegistry; skillRegistry: SkillRegistry } {
  if (route === "simple") {
    const toolRegistry = new ToolRegistry();
    const skillRegistry = new SkillRegistry();

    // Always include meta tools (escape hatch for the agent)
    for (const tool of deps.toolRegistry.list()) {
      if (isMetaToolName(tool.name)) {
        toolRegistry.register(tool);
      }
    }

    // Inject the top-N relevant action tools so the agent has them on turn 1
    let actionCount = 0;
    for (const entry of ctx.toolScores ?? []) {
      if (!isAlwaysOnToolName(entry.item.name) && actionCount < SIMPLE_ROUTE_ACTION_TOOL_LIMIT) {
        toolRegistry.register(entry.item);
        actionCount++;
      }
    }

    return { toolRegistry, skillRegistry };
  }

  // Complex route: use scored selections; fall back to full registry if empty
  const toolRegistry = new ToolRegistry();
  const skillRegistry = new SkillRegistry();

  for (const entry of ctx.toolScores ?? []) {
    toolRegistry.register(entry.item);
  }
  for (const entry of ctx.skillScores ?? []) {
    skillRegistry.register(entry.item);
  }

  if (toolRegistry.list().length === 0 && skillRegistry.list().length === 0) {
    return { toolRegistry: deps.toolRegistry, skillRegistry: deps.skillRegistry };
  }

  return { toolRegistry, skillRegistry };
}

export async function assembleRoutedSystemPrompt(
  ctx: RouteContext,
  deps: RouterDeps,
): Promise<void> {
  const route = ctx.selectedRoute;
  if (!route) {
    throw new Error("assemble-system-prompt requires selectedRoute");
  }

  const [soul, user] = await Promise.all([
    deps.profileManager.getSoul(),
    deps.profileManager.getUser(),
  ]);

  const profile = resolveRoutedProfile(route);
  const { toolRegistry, skillRegistry } = buildCapabilityRegistries(ctx, deps, route);

  const staticCtx = toStaticSectionContext(
    {
      sessionId: ctx.input.sessionId,
      soul,
      user,
      toolRegistry,
      skillRegistry,
      isSubAgent: ctx.input.isSubAgent,
      isBootstrapComplete: ctx.input.isBootstrapComplete,
      subAgentSystemPromptAppend: ctx.input.subAgentSystemPromptAppend,
      promptProfile: profile,
    },
    "principal",
  );

  const sections = [
    composeSections(routedCoreSections, staticCtx),
    route === "complex" ? composeSections(routedComplexSections, staticCtx) : "",
    buildRoutedDynamicContext(ctx, route),
  ].filter((section) => section.trim().length > 0);

  ctx.routedSystemPrompt = sections.join("\n\n");
  ctx.routedUserPrompt = ctx.input.userInput;
}
