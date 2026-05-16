import express from "express";
import http from "node:http";
import path from "node:path";
import { attachWebSocketGateway } from "./common/realtime/ws-gateway.js";
import { SessionTraceHub } from "./common/realtime/session-trace-hub.js";
import { AgentLoop, AgentType } from "./core/agent-loop.js";
import { AgentRuntimeFactory } from "./core/agent-runtime-factory.js";
import { ToolRegistry } from "./common/interfaces/registry.js";
import { createLlmAdapter } from "./llm-adapters/factory.js";
import { MemoryManager } from "./managers/memory-manager.js";
import { ProfileManager } from "./managers/profile-manager.js";
import { SecretsManager } from "./managers/secrets-manager.js";
import { SkillManager } from "./managers/skill-manager.js";
import { SchedulerRunner } from "./common/services/scheduler-runner.js";
import { ToolManager } from "./managers/tool-manager.js";
import { logger } from "./common/services/logger.js";

// Services
import { ChatService } from "./controllers/chat/chat.service.js";
import { SessionService } from "./controllers/session/session.service.js";
import { IntegrationService } from "./controllers/integration/integration.service.js";

// Controllers
import { ChatController } from "./controllers/chat/chat.controller.js";
import { SessionController } from "./controllers/session/session.controller.js";
import { IntegrationController } from "./controllers/integration/integration.controller.js";

async function main() {
  const app = express();
  app.use(express.json());
  const port = process.env.PORT || 3000;

  // Serve static UI
  app.use(express.static(path.join(process.cwd(), "ui")));

  // ── Core dependencies ──────────────────────────────────
  const memoryPath = path.join(process.cwd(), "memory");
  const memoryManager = new MemoryManager(memoryPath);
  await memoryManager.init();

  const profileManager = new ProfileManager(memoryPath);
  await profileManager.init();

  const llm = createLlmAdapter();

  const skillManager = new SkillManager(llm);
  const skillRegistry = await skillManager.loadAllSkills();

  const sessionTraceHub = new SessionTraceHub();

  const toolRegistry = new ToolRegistry();
  const toolManager = new ToolManager({
    memoryManager,
    profileManager,
    llm,
    masterToolRegistry: toolRegistry,
    masterSkillRegistry: skillRegistry,
    sessionTraceHub,
  });
  await toolManager.loadAllTools();

  const agentRuntimeFactory = new AgentRuntimeFactory({
    llm,
    memoryManager,
    profileManager,
    masterToolRegistry: toolRegistry,
    masterSkillRegistry: skillRegistry,
    sessionTraceHub,
  });

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

  const secretsManager = new SecretsManager();
  await secretsManager.init();

  // ── Service layer ──────────────────────────────────────
  const chatService = new ChatService(agentLoop, memoryManager, llm);
  const sessionService = new SessionService(memoryManager);
  const integrationService = new IntegrationService(secretsManager);

  // ── Controller layer ───────────────────────────────────
  const chatController = new ChatController(chatService);
  const sessionController = new SessionController(sessionService);
  const integrationController = new IntegrationController(integrationService);

  // ── Routes ─────────────────────────────────────────────
  // Chat
  app.post("/api/chat", chatController.handleChat);
  app.post("/api/chat/cancel", chatController.handleCancelChat);

  // Sessions
  app.get("/api/sessions", sessionController.listSessions);
  app.post("/api/sessions", sessionController.createSession);
  app.get("/api/session/:id", sessionController.getSessionHistory);
  app.get("/api/session/:id/plan", sessionController.getSessionPlan);

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
}

main();
