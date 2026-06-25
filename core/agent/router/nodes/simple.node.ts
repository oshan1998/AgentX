import { logNodeRun } from "../node-run-log.js";
import type { RouterDeps, RouteContext } from "../types.js";
import type { RouteNode } from "../graph-types.js";

export function createSimpleNode(): RouteNode {
  return {
    id: "simple",
    required: ["identify-intent", "retrieve-memory"],
    when: (ctx) => ctx.queryComplexity === "simple",

    async run(ctx: RouteContext, _deps: RouterDeps): Promise<void> {
      logNodeRun(ctx, "simple");
      ctx.selectedRoute = "simple";
    },
  };
}
