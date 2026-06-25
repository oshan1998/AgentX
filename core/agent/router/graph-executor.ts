import { logger } from "../../../common/services/logger.js";
import type { RouteGraph, NodeId } from "./graph-types.js";
import { runNodeWithTrace } from "./trace.js";
import type { RouterDeps, RouteContext } from "./types.js";

function buildDependencyMap(graph: RouteGraph): Map<NodeId, NodeId[]> {
  const dependencies = new Map<NodeId, NodeId[]>();

  for (const nodeId of graph.nodes.keys()) {
    dependencies.set(nodeId, []);
  }

  for (const edge of graph.edges) {
    const target = typeof edge.to === "function" ? null : edge.to;
    if (!target) continue;

    const existing = dependencies.get(target) ?? [];
    existing.push(edge.from);
    dependencies.set(target, existing);
  }

  for (const [nodeId, node] of graph.nodes) {
    if (!node.required?.length) continue;

    const existing = dependencies.get(nodeId) ?? [];
    for (const requiredId of node.required) {
      if (!existing.includes(requiredId)) existing.push(requiredId);
    }
    dependencies.set(nodeId, existing);
  }

  return dependencies;
}

function getNodeDependencies(
  graph: RouteGraph,
  dependencies: Map<NodeId, NodeId[]>,
  nodeId: NodeId,
): NodeId[] {
  const node = graph.nodes.get(nodeId);
  const edgeDeps = dependencies.get(nodeId) ?? [];
  const required = node?.required ?? [];
  return [...new Set([...edgeDeps, ...required])];
}

/**
 * DAG-style graph runner:
 * - Entry nodes fire when the route starts.
 * - Each node follows its own outgoing edges when it finishes.
 * - Downstream nodes wait until all predecessors complete.
 * - `required` and edges both gate execution order.
 * - `when` skips a node once dependencies are satisfied (mutually exclusive branches).
 * - `requires` re-evaluates after every completion so a node can wait for ctx data.
 */
export async function runRouteGraph(
  graph: RouteGraph,
  ctx: RouteContext,
  deps: RouterDeps,
): Promise<void> {
  const dependencies = buildDependencyMap(graph);
  const completed = new Set<NodeId>();
  const inFlight = new Set<NodeId>();

  const isInactive = (nodeId: NodeId): boolean =>
    graph.activeNodes != null && !graph.activeNodes.includes(nodeId);

  const isReady = (nodeId: NodeId): boolean => {
    if (completed.has(nodeId) || inFlight.has(nodeId)) return false;
    if (!graph.nodes.has(nodeId)) return false;

    const node = graph.nodes.get(nodeId);
    if (!node) return false;

    const nodeDeps = getNodeDependencies(graph, dependencies, nodeId);
    if (!nodeDeps.every((dep) => completed.has(dep))) return false;

    if (isInactive(nodeId)) return true;

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
      if (isInactive(nodeId)) {
        ctx.trace.push({
          nodeId: node.id,
          startedAt: Date.now(),
          durationMs: 0,
          status: "skipped",
        });
        logger.info(`[router] node "${node.id}" skipped (inactive)`, {
          sessionId: ctx.input.sessionId,
        });
      } else if (node.when && !node.when(ctx)) {
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
    activeNodes: graph.activeNodes,
    userInput: ctx.input.userInput,
  });

  await scheduleReadyNodes();

  logger.info("[router] graph execution finished", {
    sessionId: ctx.input.sessionId,
    trace: ctx.trace,
  });
}
