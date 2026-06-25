import type { RouterDeps, RouteContext } from "./types.js";

export type NodeId =
  | "classify-complexity"
  | "select-tools"
  | "select-skills"
  | "retrieve-memory"
  | "simple"
  | "complex"
  | "assemble-system-prompt";

export interface RouteNode {
  readonly id: NodeId;
  /** Node IDs that must complete before this node runs. Merged with edge predecessors. */
  required?: NodeId[];
  /** Run-time gate — if false, the node is skipped but treated as completed. */
  when?(ctx: RouteContext): boolean;
  /**
   * Data gate — node waits until this returns true even after all predecessors finish.
   * Use this when a node needs specific ctx fields before proceeding.
   */
  requires?(ctx: RouteContext): boolean;
  run(ctx: RouteContext, deps: RouterDeps): Promise<void>;
}

export type RouteEdgeTarget = NodeId | null | ((ctx: RouteContext) => NodeId | null);

export interface RouteEdge {
  from: NodeId;
  to: RouteEdgeTarget;
}

export interface RouteGraph {
  /** Starting nodes — all fire concurrently when the route begins. */
  entryNodes: NodeId[];
  nodes: Map<NodeId, RouteNode>;
  /** Outgoing edges per node — branches run independently; joins wait for all predecessors. */
  edges: RouteEdge[];
  /** When set, only these nodes are eligible to run; others are skipped. */
  activeNodes?: NodeId[];
}
