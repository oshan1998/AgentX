import type { LongTermMemoryService } from "../services/long-term-memory.service.js";
import type { RouterDeps, RouteContext } from "../types.js";
import type { RouteNode } from "./types.js";

export function createRetrieveMemoryNode(
  longTermMemoryService: LongTermMemoryService,
): RouteNode {
  return {
    id: "retrieve-memory",

    async run(ctx: RouteContext, deps: RouterDeps): Promise<void> {
      ctx.relevantLongTermMemory = await longTermMemoryService.retrieve({
        userInput: ctx.input.userInput,
        memoryManager: deps.memoryManager,
      });
    },
  };
}
