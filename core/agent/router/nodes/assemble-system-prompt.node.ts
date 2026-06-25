import { logNodeRun } from "../node-run-log.js";
import { assembleRoutedSystemPrompt } from "../system-prompt-assembler.js";
import type { RouterDeps, RouteContext } from "../types.js";
import type { RouteNode } from "../graph-types.js";

export function createAssembleSystemPromptNode(): RouteNode {
  return {
    id: "assemble-system-prompt",
    requires: (ctx) => ctx.selectedRoute != null,

    async run(ctx: RouteContext, deps: RouterDeps): Promise<void> {
      logNodeRun(ctx, "assemble-system-prompt");
      await assembleRoutedSystemPrompt(ctx, deps);
    },
  };
}
