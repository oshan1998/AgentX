import { SkillRegistry, ToolRegistry } from "../../../common/interfaces/registry.js";
import type { PromptProfile } from "../context-router.js";
import { composeSections } from "../prompt-builder/compose.js";
import { toStaticSectionContext } from "../prompt-builder/section-context.js";
import { buildRoutedDynamicContext } from "./route-prompt.js";
import { routedComplexSections, routedCoreSections } from "./routed-prompt-recipes.js";
import type { RouterDeps, RouteContext, RoutePath } from "./types.js";

function resolveRoutedProfile(route: RoutePath): PromptProfile {
  return route === "simple" ? "chat" : "planning";
}

function buildCapabilityRegistries(
  ctx: RouteContext,
  deps: RouterDeps,
  route: RoutePath,
): { toolRegistry: ToolRegistry; skillRegistry: SkillRegistry } {
  if (route === "simple") {
    return { toolRegistry: new ToolRegistry(), skillRegistry: new SkillRegistry() };
  }

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
