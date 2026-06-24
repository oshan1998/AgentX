import { logger } from "../../../common/services/logger.js";
import type { RouteGraph, NodeId } from "./nodes/types.js";
import { runNodeWithTrace } from "./trace.js";
import type { RouterDeps, RouteContext } from "./types.js";

function buildPredecessorMap(
  entryNodes: NodeId[],
  edges: RouteGraph["edges"],
): Map<NodeId, NodeId[]> {
  const predecessors = new Map<NodeId, NodeId[]>();

  for (const nodeId of entryNodes) {
    predecessors.set(nodeId, []);
  }

  for (const edge of edges) {
    const target = typeof edge.to === "function" ? null : edge.to;
    if (!target) continue;

    const existing = predecessors.get(target) ?? [];
    existing.push(edge.from);
    predecessors.set(target, existing);
  }

  return predecessors;
}

/**
 * DAG-style graph runner:
 * - Entry nodes fire when the route starts.
 * - Each node follows its own outgoing edges when it finishes.
 * - Downstream nodes wait until all predecessors complete.
 * - `requires` re-evaluates after every completion so a node can wait for ctx data.
 */
export async function runRouteGraph(
  graph: RouteGraph,
  ctx: RouteContext,
  deps: RouterDeps,
): Promise<void> {
  const predecessors = buildPredecessorMap(graph.entryNodes, graph.edges);
  const completed = new Set<NodeId>();
  const inFlight = new Set<NodeId>();

  const hasPredecessorMap = (nodeId: NodeId): boolean =>
    predecessors.has(nodeId) || graph.entryNodes.includes(nodeId);

  const isReady = (nodeId: NodeId): boolean => {
    if (completed.has(nodeId) || inFlight.has(nodeId)) return false;
    if (!hasPredecessorMap(nodeId)) return false;

    const node = graph.nodes.get(nodeId);
    if (!node) return false;
    if (node.when && !node.when(ctx)) return false;

    const preds = predecessors.get(nodeId) ?? [];
    if (!preds.every((pred) => completed.has(pred))) return false;
    if (node.requires && !node.requires(ctx)) return false;

    return true;
  };

  const runNode = async (nodeId: NodeId): Promise<void> => {
    if (completed.has(nodeId) || inFlight.has(nodeId) || !isReady(nodeId)) return;

    const node = graph.nodes.get(nodeId);
    if (!node) {
      completed.add(nodeId);
      await scheduleReadyNodes();
      return;
    }

    inFlight.add(nodeId);

    try {
      if (node.when && !node.when(ctx)) {
        ctx.trace.push({
          nodeId: node.id,
          startedAt: Date.now(),
          durationMs: 0,
          status: "skipped",
        });
        logger.info(`[router] node "${node.id}" skipped`, {
          sessionId: ctx.input.sessionId,
        });
      } else {
        await runNodeWithTrace(ctx, deps, node, { throwOnError: false });
      }
    } finally {
      inFlight.delete(nodeId);
      completed.add(nodeId);
    }

    await scheduleReadyNodes();
  };

  const scheduleReadyNodes = async (): Promise<void> => {
    const readyNodeIds = [...graph.nodes.keys()].filter(isReady);
    if (readyNodeIds.length > 0) {
      logger.debug("[router] scheduling nodes", {
        sessionId: ctx.input.sessionId,
        readyNodeIds,
        completed: [...completed],
      });
    }
    await Promise.all(readyNodeIds.map((nodeId) => runNode(nodeId)));
  };

  logger.info("[router] graph execution started", {
    sessionId: ctx.input.sessionId,
    entryNodes: graph.entryNodes,
    userInput: ctx.input.userInput,
  });

  await scheduleReadyNodes();

  logger.info("[router] graph execution finished", {
    sessionId: ctx.input.sessionId,
    trace: ctx.trace,
  });
}
