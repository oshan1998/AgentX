import type { NodeId } from "./graph-types.js";
import type { RouteContext } from "./types.js";

export function logNodeRun(ctx: RouteContext, nodeId: NodeId): void {
  console.log(`[route-node:${nodeId}] user="${ctx.input.userInput}"`);
}
