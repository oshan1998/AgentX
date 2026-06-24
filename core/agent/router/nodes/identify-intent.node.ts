import type { IntentIdentificationService } from "../services/intent-identification.service.js";
import type { RouterDeps, RouteContext } from "../types.js";
import type { RouteNode } from "./types.js";

export function createIdentifyIntentNode(
  intentService: IntentIdentificationService,
): RouteNode {
  return {
    id: "identify-intent",

    async run(ctx: RouteContext, deps: RouterDeps): Promise<void> {
      ctx.intent = await intentService.identify({
        userInput: ctx.input.userInput,
        llm: deps.llm,
      });
    },
  };
}
