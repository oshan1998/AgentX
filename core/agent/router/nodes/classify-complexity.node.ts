import { logNodeRun } from "../node-run-log.js";
import { isAlwaysOnToolName } from "../../capability-retriever.js";
import type { RouterDeps, RouteContext } from "../types.js";
import type { RouteNode } from "../graph-types.js";

/**
 * Minimum relevance score for a tool or skill to count as "needed".
 * LLM-selected items always score 1.0; RAG items use cosine similarity.
 */
const TOOL_NEED_THRESHOLD = 0.5;

export function createClassifyComplexityNode(): RouteNode {
  return {
    id: "classify-complexity",
    required: ["select-tools", "select-skills"],

    async run(ctx: RouteContext, _deps: RouterDeps): Promise<void> {
      logNodeRun(ctx, "classify-complexity");

      const hasNeededTool = (ctx.toolScores ?? []).some(
        (t) => !isAlwaysOnToolName(t.item.name) && t.score >= TOOL_NEED_THRESHOLD,
      );
      const hasNeededSkill = (ctx.skillScores ?? []).some(
        (s) => s.score >= TOOL_NEED_THRESHOLD,
      );

      ctx.queryComplexity = hasNeededTool || hasNeededSkill ? "complex" : "simple";
    },
  };
}
