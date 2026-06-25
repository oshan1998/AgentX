import { logger } from "../../../common/services/logger.js";
import { runRouteGraph } from "./graph-executor.js";
import { createAssembleSystemPromptNode } from "./nodes/assemble-system-prompt.node.js";
import { createClassifyComplexityNode } from "./nodes/classify-complexity.node.js";
import { createComplexNode } from "./nodes/complex.node.js";
import { createRetrieveMemoryNode } from "./nodes/retrieve-memory.node.js";
import { createSelectSkillsNode } from "./nodes/select-skills.node.js";
import { createSelectToolsNode } from "./nodes/select-tools.node.js";
import { createSimpleNode } from "./nodes/simple.node.js";
import type { RouteEdge, RouteGraph, RouteNode, NodeId } from "./graph-types.js";
import { LongTermMemoryService } from "./services/long-term-memory.service.js";
import { SkillSelectionService } from "./services/skill-selection.service.js";
import { ToolSelectionService } from "./services/tool-selection.service.js";
import type { RouteContext, RouteInput, RouteResult, RouterDeps } from "./types.js";

export interface RouterServices {
  toolSelectionService?: ToolSelectionService;
  skillSelectionService?: SkillSelectionService;
  longTermMemoryService?: LongTermMemoryService;
}

export class Router {
  private readonly graph: RouteGraph;
  private readonly toolSelectionService: ToolSelectionService;
  private readonly skillSelectionService: SkillSelectionService;
  private readonly longTermMemoryService: LongTermMemoryService;

  constructor(services?: RouterServices) {
    this.toolSelectionService = services?.toolSelectionService ?? new ToolSelectionService();
    this.skillSelectionService = services?.skillSelectionService ?? new SkillSelectionService();
    this.longTermMemoryService = services?.longTermMemoryService ?? new LongTermMemoryService();

    const nodes = new Map<NodeId, RouteNode>([
      ["retrieve-memory", createRetrieveMemoryNode(this.longTermMemoryService)],
      ["select-tools", createSelectToolsNode(this.toolSelectionService)],
      ["select-skills", createSelectSkillsNode(this.skillSelectionService)],
      ["classify-complexity", createClassifyComplexityNode()],
      ["simple", createSimpleNode()],
      ["complex", createComplexNode()],
      ["assemble-system-prompt", createAssembleSystemPromptNode()],
    ]);

    const edges: RouteEdge[] = [
      { from: "simple", to: "assemble-system-prompt" },
      { from: "complex", to: "assemble-system-prompt" },
    ];

    this.graph = {
      entryNodes: ["retrieve-memory", "select-tools", "select-skills"],
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
      queryComplexity: ctx.queryComplexity,
      selectedRoute: ctx.selectedRoute,
      systemPromptChars: ctx.routedSystemPrompt?.length ?? 0,
      userPromptChars: ctx.routedUserPrompt?.length ?? 0,
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
