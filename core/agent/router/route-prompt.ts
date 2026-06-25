import type { RouteContext, RoutePath } from "./types.js";

function formatMemory(ctx: RouteContext): string | undefined {
  if (!ctx.relevantLongTermMemory?.length) return undefined;
  return ctx.relevantLongTermMemory.map((entry) => `- ${entry.content}`).join("\n");
}

function formatIntent(ctx: RouteContext): string | undefined {
  if (!ctx.intent) return undefined;
  const confidence =
    ctx.intent.confidence != null ? ` (confidence: ${ctx.intent.confidence})` : "";
  return `Intent: ${ctx.intent.label}${confidence}`;
}

function formatTools(ctx: RouteContext): string | undefined {
  if (!ctx.toolScores?.length) return undefined;
  return ctx.toolScores
    .map((entry) => `- ${entry.item.name}: ${entry.item.description}`)
    .join("\n");
}

function formatSkills(ctx: RouteContext): string | undefined {
  if (!ctx.skillScores?.length) return undefined;
  return ctx.skillScores
    .map((entry) => `- ${entry.item.name}: ${entry.item.description}`)
    .join("\n");
}

/** Route-specific context gathered by upstream nodes (intent, memory, selections). */
export function buildRoutedDynamicContext(ctx: RouteContext, route: RoutePath): string {
  const sections: string[] = [];

  const intent = formatIntent(ctx);
  if (intent) sections.push(intent);

  const memory = formatMemory(ctx);
  if (memory) sections.push(`Relevant memory:\n${memory}`);

  if (route === "complex") {
    const tools = formatTools(ctx);
    if (tools) sections.push(`Selected tools:\n${tools}`);

    const skills = formatSkills(ctx);
    if (skills) sections.push(`Selected skills:\n${skills}`);
  }

  return sections.join("\n\n");
}
