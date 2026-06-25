import { logNodeRun } from "../node-run-log.js";
import type { RouterDeps, RouteContext } from "../types.js";
import type { RouteNode } from "../graph-types.js";

export function createComplexNode(): RouteNode {
  return {
    id: "complex",
    required: ["identify-intent", "retrieve-memory", "select-tools", "select-skills"],
    when: (ctx) => ctx.queryComplexity === "complex",

    async run(ctx: RouteContext, _deps: RouterDeps): Promise<void> {
      logNodeRun(ctx, "complex");
      ctx.selectedRoute = "complex";
    },
  };
}
