import "dotenv/config";
import express from "express";
import http from "node:http";
import path from "node:path";
import multer from "multer";
import { attachWebSocketGateway } from "./common/realtime/ws-gateway.js";
import { SessionTraceHub } from "./common/realtime/session-trace-hub.js";
import { AgentLoop, AgentType, AgentRuntimeFactory, registerDelegateToolOnce } from "./core/index.js";
import { resolveCapabilityRetrievalMethod } from "./core/agent/capability-retriever.js";
import { ListCapabilitiesTool } from "./runtime/tools/list-capabilities.js";
import { GetCapabilitySchemaTool } from "./runtime/tools/get-capability-schema.js";
import { createLlmAdapter } from "./llm-adapters/factory.js";
import { resolveVertexRagLocation } from "./llm-adapters/vertex-config.js";
import { MemoryManager } from "./managers/memory-manager.js";
import { ProfileManager } from "./managers/profile-manager.js";
import { SecretsManager } from "./managers/secrets-manager.js";
import { SkillManager } from "./managers/skill-manager.js";
import { SchedulerRunner } from "./common/services/scheduler-runner.js";
import { ToolManager } from "./managers/tool-manager.js";
import { McpClientManager } from "./managers/mcp/index.js";
import { logger } from "./common/services/logger.js";
import { VectorManager } from "./managers/vector-manager.js";
import { VertexRagManager } from "./managers/vertex-rag-manager.js";

// Services
import { ChatService } from "./controllers/chat/chat.service.js";
import { SessionService } from "./controllers/session/session.service.js";
import { IntegrationService } from "./controllers/integration/integration.service.js";

// Controllers
import { ChatController } from "./controllers/chat/chat.controller.js";
import { SessionController } from "./controllers/session/session.controller.js";
import { IntegrationController } from "./controllers/integration/integration.controller.js";
import { WorkspaceService } from "./controllers/workspace/workspace.service.js";
import { WorkspaceController } from "./controllers/workspace/workspace.controller.js";

async function main() {
  const app = express();
  app.use(express.json());
  const port = process.env.PORT || 3000;

  // Serve static UI
  app.use(express.static(path.join(process.cwd(), "ui")));

  // Serve workspace files statically so UI can access generated images/files directly
  app.use("/workspace", express.static(path.join(process.cwd(), "workspace")));

  // ── Core dependencies ──────────────────────────────────
  const memoryPath = path.join(process.cwd(), "memory");

  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  let vectorManager: VectorManager | undefined;
  let vertexRagManager: VertexRagManager | undefined;

  if (projectId) {
    logger.info("Initializing VectorManager...");
    vectorManager = new VectorManager({
      projectId,
      location: process.env.GOOGLE_CLOUD_LOCATION,
      storagePath: path.join(memoryPath, "vector-store.json"),
    });
    await vectorManager.init();
  } else {
    logger.warn("GOOGLE_CLOUD_PROJECT is not set; VectorManager will be disabled (RAG disabled).");
  }

  const memoryManager = new MemoryManager(memoryPath, vectorManager);
  await memoryManager.init();

  const profileManager = new ProfileManager(memoryPath);
  await profileManager.init();

  const toolManager = new ToolManager(memoryManager, process.cwd());
  const toolRegistry = await toolManager.loadAllTools();

  // External MCP servers contribute additional tools into the same registry, so
  // the agent loop, skills, sub-agents, and orchestrator treat them as native.
  const mcpClientManager = await McpClientManager.fromConfig();
  await mcpClientManager.registerInto(toolRegistry);

  const llm = createLlmAdapter();

  const skillManager = new SkillManager(llm);
  const skillRegistry = await skillManager.loadAllSkills();

  const sessionTraceHub = new SessionTraceHub();

  const agentRuntimeFactory = new AgentRuntimeFactory({
    llm,
    memoryManager,
    profileManager,
    masterToolRegistry: toolRegistry,
    masterSkillRegistry: skillRegistry,
    sessionTraceHub,
  });
  registerDelegateToolOnce(toolRegistry, agentRuntimeFactory.delegateTool);
  registerDelegateToolOnce(toolRegistry, agentRuntimeFactory.orchestrateTool);
  registerDelegateToolOnce(
    toolRegistry,
    new ListCapabilitiesTool(toolRegistry, skillRegistry),
  );
  registerDelegateToolOnce(
    toolRegistry,
    new GetCapabilitySchemaTool(toolRegistry, skillRegistry),
  );

  const capabilityRetrievalMethod = resolveCapabilityRetrievalMethod();
  logger.info(`Capability retrieval method: ${capabilityRetrievalMethod}`);

  if (capabilityRetrievalMethod === "vertex_rag" && projectId) {
    logger.info("Initializing VertexRagManager...");
    const ragLocation = resolveVertexRagLocation();
    logger.info(`Vertex RAG location: ${ragLocation}`);
    vertexRagManager = new VertexRagManager({
      projectId,
      location: ragLocation,
      storagePath: path.join(memoryPath, "vertex-rag-state.json"),
    });
    await vertexRagManager.init();
    await vertexRagManager.indexCapabilities(toolRegistry.list(), skillRegistry.list());
  } else if (vectorManager) {
    await vectorManager.indexCapabilities(toolRegistry.list(), skillRegistry.list());
  }

  const agentLoop = new AgentLoop({
    llm,
    memoryManager,
    profileManager,
    toolRegistry,
    skillRegistry,
    sessionTraceHub,
    agentType: AgentType.Primary,
    skillDelegateRunner: agentRuntimeFactory.skillDelegateRunner,
    vectorManager,
    vertexRagManager,
    capabilityRetrievalMethod,
  });

  const schedulerRunner = new SchedulerRunner(agentLoop);
  schedulerRunner.start();

  const secretsManager = new SecretsManager();
  await secretsManager.init();

  // ── Service layer ──────────────────────────────────────
  const chatService = new ChatService(agentLoop, memoryManager, llm);
  const sessionService = new SessionService(memoryManager);
  const integrationService = new IntegrationService(secretsManager);
  const workspaceService = new WorkspaceService();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 },
  });

  // ── Controller layer ───────────────────────────────────
  const chatController = new ChatController(chatService);
  const sessionController = new SessionController(sessionService);
  const integrationController = new IntegrationController(integrationService);
  const workspaceController = new WorkspaceController(workspaceService);

  // ── Routes ─────────────────────────────────────────────
  // Chat
  app.post("/api/chat", chatController.handleChat);
  app.post("/api/chat/cancel", chatController.handleCancelChat);

  // Sessions
  app.get("/api/sessions", sessionController.listSessions);
  app.post("/api/sessions", sessionController.createSession);
  app.get("/api/session/:id", sessionController.getSessionHistory);
  app.get("/api/session/:id/plan", sessionController.getSessionPlan);

  // Session workspace files
  app.post(
    "/api/session/:id/files",
    upload.single("file"),
    workspaceController.uploadFile,
  );
  app.get("/api/session/:id/files", workspaceController.listFiles);

  // Integrations — Gmail
  app.get("/api/auth/gmail", integrationController.getGmailAuthUrl);
  app.get("/api/auth/gmail/callback", integrationController.handleGmailCallback);
  app.get("/api/auth/gmail/status", integrationController.getGmailStatus);
  app.delete("/api/auth/gmail", integrationController.disconnectGmail);

  const server = http.createServer(app);
  attachWebSocketGateway(server, sessionTraceHub);

  server.listen(port, () => {
    logger.info(`HTTP + WebSocket server at http://localhost:${port} (ws path /ws)`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}; closing MCP connections and HTTP server.`);
    await mcpClientManager.close();
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main();
