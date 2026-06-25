import type { ToolSelectionService } from "../services/tool-selection.service.js";
import { logNodeRun } from "../node-run-log.js";
import type { RouterDeps, RouteContext } from "../types.js";
import type { RouteNode } from "../graph-types.js";

export function createSelectToolsNode(
  toolSelectionService: ToolSelectionService,
): RouteNode {
  return {
    id: "select-tools",
    required: ["identify-intent"],
    when: (ctx) => ctx.queryComplexity === "complex",

    async run(ctx: RouteContext, deps: RouterDeps): Promise<void> {
      logNodeRun(ctx, "select-tools");
      ctx.toolScores = await toolSelectionService.select({
        userInput: ctx.input.userInput,
        llm: deps.llm,
        toolRegistry: deps.toolRegistry,
        vectorManager: deps.vectorManager,
        capabilityRetrievalMethod: deps.capabilityRetrievalMethod,
      });
    },
  };
}
