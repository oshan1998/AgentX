import { logger } from "../../../common/services/logger.js";
import { runRouteGraph } from "./graph-executor.js";
import { createIdentifyIntentNode } from "./nodes/identify-intent.node.js";
import { createRetrieveMemoryNode } from "./nodes/retrieve-memory.node.js";
import { createSelectSkillsNode } from "./nodes/select-skills.node.js";
import { createSelectToolsNode } from "./nodes/select-tools.node.js";
import type { RouteEdge, RouteGraph, RouteNode, NodeId } from "./nodes/types.js";
import { IntentIdentificationService } from "./services/intent-identification.service.js";
import { LongTermMemoryService } from "./services/long-term-memory.service.js";
import { SkillSelectionService } from "./services/skill-selection.service.js";
import { ToolSelectionService } from "./services/tool-selection.service.js";
import type { RouteContext, RouteInput, RouteResult, RouterDeps } from "./types.js";

export interface RouterServices {
  intentService?: IntentIdentificationService;
  toolSelectionService?: ToolSelectionService;
  skillSelectionService?: SkillSelectionService;
  longTermMemoryService?: LongTermMemoryService;
}

export class Router {
  private readonly graph: RouteGraph;
  private readonly intentService: IntentIdentificationService;
  private readonly toolSelectionService: ToolSelectionService;
  private readonly skillSelectionService: SkillSelectionService;
  private readonly longTermMemoryService: LongTermMemoryService;

  constructor(services?: RouterServices) {
    this.intentService = services?.intentService ?? new IntentIdentificationService();
    this.toolSelectionService = services?.toolSelectionService ?? new ToolSelectionService();
    this.skillSelectionService = services?.skillSelectionService ?? new SkillSelectionService();
    this.longTermMemoryService = services?.longTermMemoryService ?? new LongTermMemoryService();

    const nodes = new Map<NodeId, RouteNode>([
      ["identify-intent", createIdentifyIntentNode(this.intentService)],
      ["select-tools", createSelectToolsNode(this.toolSelectionService)],
      ["select-skills", createSelectSkillsNode(this.skillSelectionService)],
      ["retrieve-memory", createRetrieveMemoryNode(this.longTermMemoryService)],
    ]);

    const edges: RouteEdge[] = [];

    this.graph = {
      entryNodes: [
        "identify-intent",
        "select-tools",
        "select-skills",
        "retrieve-memory",
      ],
      nodes,
      edges,
    };
  }

  async route(input: RouteInput, deps: RouterDeps): Promise<RouteResult> {
    logger.info("[router] route started", {
      sessionId: input.sessionId,
      userInput: input.userInput,
      isSubAgent: input.isSubAgent,
      isBootstrapComplete: input.isBootstrapComplete,
    });

    const ctx = this.createContext(input);
    await runRouteGraph(this.graph, ctx, deps);

    logger.info("[router] route completed", {
      sessionId: input.sessionId,
      intent: ctx.intent?.label,
      toolCount: ctx.toolScores?.length ?? 0,
      skillCount: ctx.skillScores?.length ?? 0,
      memoryCount: ctx.relevantLongTermMemory?.length ?? 0,
      nodeTrace: ctx.trace,
    });

    return { context: ctx };
  }

  private createContext(input: RouteInput): RouteContext {
    return {
      input,
      trace: [],
    };
  }
}
