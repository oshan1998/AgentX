import type { ToolSelectionService } from "../services/tool-selection.service.js";
import type { RouterDeps, RouteContext } from "../types.js";
import type { RouteNode } from "./types.js";

export function createSelectToolsNode(
  toolSelectionService: ToolSelectionService,
): RouteNode {
  return {
    id: "select-tools",

    async run(ctx: RouteContext, deps: RouterDeps): Promise<void> {
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
