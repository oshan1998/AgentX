import { logger } from "../../../common/services/logger.js";
import type { RouterDeps, RouteContext } from "./types.js";
import type { RouteNode } from "./graph-types.js";

export interface RunNodeOptions {
  /** When false, records failure in trace but does not rethrow. Default: true. */
  throwOnError?: boolean;
}

function summarizeNodeOutput(ctx: RouteContext, nodeId: string): Record<string, unknown> {
  switch (nodeId) {
    case "identify-intent":
      return {
        intent: ctx.intent?.label ?? null,
        queryComplexity: ctx.queryComplexity ?? null,
      };
    case "select-tools":
      return {
        toolCount: ctx.toolScores?.length ?? 0,
        tools: ctx.toolScores?.slice(0, 5).map((t) => t.item.name) ?? [],
      };
    case "select-skills":
      return {
        skillCount: ctx.skillScores?.length ?? 0,
        skills: ctx.skillScores?.slice(0, 5).map((s) => s.item.name) ?? [],
      };
    case "retrieve-memory":
      return { memoryCount: ctx.relevantLongTermMemory?.length ?? 0 };
    case "simple":
    case "complex":
      return { selectedRoute: ctx.selectedRoute ?? null };
    case "assemble-system-prompt":
      return {
        selectedRoute: ctx.selectedRoute ?? null,
        systemPromptChars: ctx.routedSystemPrompt?.length ?? 0,
        userPromptChars: ctx.routedUserPrompt?.length ?? 0,
      };
    default:
      return {};
  }
}

export async function runNodeWithTrace(
  ctx: RouteContext,
  deps: RouterDeps,
  node: RouteNode,
  options?: RunNodeOptions,
): Promise<void> {
  const startedAt = Date.now();
  const throwOnError = options?.throwOnError ?? true;

  logger.info(`[router] node "${node.id}" started`, {
    sessionId: ctx.input.sessionId,
    userInput: ctx.input.userInput,
  });

  try {
    await node.run(ctx, deps);
    const durationMs = Date.now() - startedAt;
    ctx.trace.push({
      nodeId: node.id,
      startedAt,
      durationMs,
      status: "ok",
    });
    logger.info(`[router] node "${node.id}" completed`, {
      sessionId: ctx.input.sessionId,
      durationMs,
      ...summarizeNodeOutput(ctx, node.id),
    });
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const error = err instanceof Error ? err.message : String(err);
    ctx.trace.push({
      nodeId: node.id,
      startedAt,
      durationMs,
      status: "failed",
      error,
    });
    logger.error(`[router] node "${node.id}" failed`, {
      sessionId: ctx.input.sessionId,
      durationMs,
      error,
    });
    if (throwOnError) throw err;
  }
}
