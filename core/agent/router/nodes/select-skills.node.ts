import type { SkillSelectionService } from "../services/skill-selection.service.js";
import { logNodeRun } from "../node-run-log.js";
import type { RouterDeps, RouteContext } from "../types.js";
import type { RouteNode } from "../graph-types.js";

export function createSelectSkillsNode(
  skillSelectionService: SkillSelectionService,
): RouteNode {
  return {
    id: "select-skills",

    async run(ctx: RouteContext, deps: RouterDeps): Promise<void> {
      logNodeRun(ctx, "select-skills");
      ctx.skillScores = await skillSelectionService.select({
        userInput: ctx.input.userInput,
        llm: deps.llm,
        skillRegistry: deps.skillRegistry,
        vectorManager: deps.vectorManager,
        capabilityRetrievalMethod: deps.capabilityRetrievalMethod,
      });
    },
  };
}
