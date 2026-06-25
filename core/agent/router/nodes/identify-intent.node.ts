import type { IntentIdentificationService } from "../services/intent-identification.service.js";
import { logNodeRun } from "../node-run-log.js";
import type { RouterDeps, RouteContext } from "../types.js";
import type { RouteNode } from "../graph-types.js";

export function createIdentifyIntentNode(
  intentService: IntentIdentificationService,
): RouteNode {
  return {
    id: "identify-intent",

    async run(ctx: RouteContext, deps: RouterDeps): Promise<void> {
      logNodeRun(ctx, "identify-intent");
      const result = await intentService.identify({
        userInput: ctx.input.userInput,
        llm: deps.llm,
      });
      ctx.intent = result.intent;
      ctx.queryComplexity = result.queryComplexity;
    },
  };
}
