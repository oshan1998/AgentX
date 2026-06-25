import type { LongTermMemoryService } from "../services/long-term-memory.service.js";
import { logNodeRun } from "../node-run-log.js";
import type { RouterDeps, RouteContext } from "../types.js";
import type { RouteNode } from "../graph-types.js";

export function createRetrieveMemoryNode(
  longTermMemoryService: LongTermMemoryService,
): RouteNode {
  return {
    id: "retrieve-memory",

    async run(ctx: RouteContext, deps: RouterDeps): Promise<void> {
      logNodeRun(ctx, "retrieve-memory");
      ctx.relevantLongTermMemory = await longTermMemoryService.retrieve({
        userInput: ctx.input.userInput,
        memoryManager: deps.memoryManager,
      });
    },
  };
}
