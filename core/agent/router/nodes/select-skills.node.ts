import type { SkillSelectionService } from "../services/skill-selection.service.js";
import type { RouterDeps, RouteContext } from "../types.js";
import type { RouteNode } from "./types.js";

export function createSelectSkillsNode(
  skillSelectionService: SkillSelectionService,
): RouteNode {
  return {
    id: "select-skills",

    async run(ctx: RouteContext, deps: RouterDeps): Promise<void> {
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
