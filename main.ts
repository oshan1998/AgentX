import "dotenv/config";
import express from "express";
import http from "node:http";
import path from "node:path";
import multer from "multer";
import { attachWebSocketGateway } from "./common/realtime/ws-gateway.js";
import { SessionTraceHub } from "./common/realtime/session-trace-hub.js";
import { AgentLoop, AgentType, AgentRuntimeFactory, registerDelegateToolOnce } from "./core/index.js";
import { ListCapabilitiesTool } from "./capabilities/core/tools/list-capabilities.js";
import { createLlmAdapter } from "./llm-adapters/factory.js";
import { MemoryManager } from "./managers/memory-manager.js";
import { ProfileManager } from "./managers/profile-manager.js";
import { SkillManager } from "./managers/skill-manager.js";
import { SchedulerRunner } from "./common/services/scheduler-runner.js";
import { ToolManager } from "./managers/tool-manager.js";
import { logger } from "./common/services/logger.js";

// Services
import { ChatService } from "./controllers/chat/chat.service.js";
import { SessionService } from "./controllers/session/session.service.js";
// Controllers
import { ChatController } from "./controllers/chat/chat.controller.js";
import { SessionController } from "./controllers/session/session.controller.js";
import { WorkspaceService } from "./controllers/workspace/workspace.service.js";
import { WorkspaceController } from "./controllers/workspace/workspace.controller.js";
import { GcsService } from "./common/services/gcs.service.js";
import { RagCorpusStore } from "./common/services/rag-corpus-store.js";
import { CorpusService } from "./common/services/corpus.service.js";
import { VertexRagEngineService } from "./common/services/vertex-rag-engine.service.js";
import { VertexRagRetriever } from "./common/services/vertex-rag.retriever.js";
import { CorpusController } from "./controllers/corpus/corpus.controller.js";

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
  const memoryManager = new MemoryManager(memoryPath);
  await memoryManager.init();

  const profileManager = new ProfileManager(memoryPath);
  await profileManager.init();

  const gcsService = new GcsService();
  const ragCorpusStore = new RagCorpusStore();
  const ragEngine = new VertexRagEngineService();
  try {
    await ragEngine.ensureServerlessMode();
    logger.info("Vertex RAG Engine serverless mode ready (us-central1)");
  } catch (error) {
    logger.warn(`Vertex RAG serverless setup skipped: ${String(error)}`);
  }
  const corpusService = new CorpusService(ragEngine, gcsService, ragCorpusStore);
  try {
    await corpusService.ensureCorpus();
    logger.info("App knowledge base corpus ready");
  } catch (error) {
    logger.warn(`Corpus bootstrap skipped: ${String(error)}`);
  }
  const retriever = new VertexRagRetriever(ragEngine, corpusService);

  const toolManager = new ToolManager(memoryManager, {
    rag: {
      gcsService,
      ragEngine,
      corpusService,
      retriever,
    },
  });
  const toolRegistry = await toolManager.loadAllTools();

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

  const agentLoop = new AgentLoop({
    llm,
    memoryManager,
    profileManager,
    toolRegistry,
    skillRegistry,
    sessionTraceHub,
    agentType: AgentType.Primary,
    skillDelegateRunner: agentRuntimeFactory.skillDelegateRunner,
  });

  const schedulerRunner = new SchedulerRunner(agentLoop);
  schedulerRunner.start();

  // ── Service layer ──────────────────────────────────────
  const chatService = new ChatService(agentLoop, memoryManager, llm);
  const sessionService = new SessionService(memoryManager);
  const workspaceService = new WorkspaceService();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 },
  });

  // ── Controller layer ───────────────────────────────────
  const chatController = new ChatController(chatService);
  const sessionController = new SessionController(sessionService);
  const workspaceController = new WorkspaceController(workspaceService);
  const corpusController = new CorpusController(corpusService);

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

  // App knowledge base (single corpus)
  app.post(
    "/api/corpus/documents",
    upload.single("file"),
    corpusController.uploadDocument,
  );
  app.get("/api/corpus/documents", corpusController.listDocuments);

  const server = http.createServer(app);
  attachWebSocketGateway(server, sessionTraceHub);

  server.listen(port, () => {
    logger.info(`HTTP + WebSocket server at http://localhost:${port} (ws path /ws)`);
  });
}

main();
