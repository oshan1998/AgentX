import express from "express";
import path from "node:path";
import { AgentLoop } from "./core/agent-loop.js";
import { createLlmAdapter } from "./llm-adapters/factory.js";
import { MemoryManager } from "./managers/memory-manager.js";
import { ProfileManager } from "./managers/profile-manager.js";
import fs from "node:fs/promises";
import { SkillManager } from "./managers/skill-manager.js";
import { SchedulerRunner } from "./services/scheduler-runner.js";
import { ToolManager } from "./managers/tool-manager.js";
import { logger } from "./services/logger.js";

async function main() {
  const app = express();
  app.use(express.json());
  const port = process.env.PORT || 3000;

  // Serve static UI
  app.use(express.static(path.join(process.cwd(), "ui")));

  // Agent setup
  const sessionId = "web-session";
  const memoryPath = path.join(process.cwd(), "memory");
  const memoryManager = new MemoryManager(memoryPath);
  await memoryManager.init();

  const profileManager = new ProfileManager(memoryPath);
  await profileManager.init();

  const toolManager = new ToolManager(memoryManager);
  const toolRegistry = await toolManager.loadAllTools();

  const llm = createLlmAdapter();

  // Use SkillManager to load and register all skills
  const skillManager = new SkillManager(llm);
  const skillRegistry = await skillManager.loadAllSkills();

  const agentLoop = new AgentLoop({
    llm,
    memoryManager,
    profileManager,
    toolRegistry,
    skillRegistry,
  });
  const schedulerRunner = new SchedulerRunner(agentLoop);
  schedulerRunner.start();

  // Chat API
  app.post("/api/chat", async (req, res) => {
    const { message, sessionId } = req.body;
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Missing message" });
    }
    // Accept sessionId from client, fallback to web-session
    const sid =
      typeof sessionId === "string" && sessionId.length > 0
        ? sessionId
        : "web-session";
    try {
      const response = await agentLoop.handleUserInput(sid, message);
      res.json({ response });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  // List sessions API
  app.get("/api/sessions", async (_req, res) => {
    try {
      const sessionsDir = path.join(process.cwd(), "memory", "sessions");
      const files = await fs.readdir(sessionsDir);
      const sessions = files
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(/\.json$/, ""));
      res.json({ sessions });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  // Get session history API
  app.get("/api/session/:id", async (req, res) => {
    const sessionId = req.params.id;
    try {
      const session = await memoryManager.getSession(sessionId);
      // only user and assistant messages for UI
      session.messages = session.messages.filter(
        (m: any) => m.role === "user" || m.role === "assistant",
      );
      res.json(session);
    } catch (e) {
      res.status(404).json({ error: "Session not found" });
    }
  });

  app.listen(port, () => {
    logger.info(`UI server running at http://localhost:${port}`);

  });
}

main();
