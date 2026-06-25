import { logger } from "../../../common/services/logger.js";
import { runRouteGraph } from "./graph-executor.js";
import { createAssembleSystemPromptNode } from "./nodes/assemble-system-prompt.node.js";
import { createIdentifyIntentNode } from "./nodes/identify-intent.node.js";
import { createComplexNode } from "./nodes/complex.node.js";
import { createRetrieveMemoryNode } from "./nodes/retrieve-memory.node.js";
import { createSelectSkillsNode } from "./nodes/select-skills.node.js";
import { createSelectToolsNode } from "./nodes/select-tools.node.js";
import { createSimpleNode } from "./nodes/simple.node.js";
import type { RouteEdge, RouteGraph, RouteNode, NodeId } from "./graph-types.js";
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
      ["simple", createSimpleNode()],
      ["complex", createComplexNode()],
      ["assemble-system-prompt", createAssembleSystemPromptNode()],
    ]);

    const edges: RouteEdge[] = [
      { from: "identify-intent", to: "select-tools" },
      { from: "identify-intent", to: "select-skills" },
      { from: "identify-intent", to: "simple" },
      { from: "identify-intent", to: "complex" },
      { from: "retrieve-memory", to: "simple" },
      { from: "retrieve-memory", to: "complex" },
      { from: "select-tools", to: "complex" },
      { from: "select-skills", to: "complex" },
      { from: "simple", to: "assemble-system-prompt" },
      { from: "complex", to: "assemble-system-prompt" },
    ];

    this.graph = {
      entryNodes: ["identify-intent", "retrieve-memory"],
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
