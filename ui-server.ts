import express from "express";
import path from "node:path";
import { AgentLoop } from "./core/agent-loop.js";
import { OpenAIAdapter } from "./core/llm-adapter.js";
import { MemoryManager } from "./core/memory-manager.js";
import { MockLlmAdapter } from "./core/mock-llm-adapter.js";
import fs from "node:fs/promises";
import { SkillManager } from "./skills/skillManager.js";
import { ToolManager } from "./tools/toolManager.js";

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

  const toolManager = new ToolManager(memoryManager);
  const toolRegistry = await toolManager.loadAllTools();

  const llm = process.env.OPENAI_API_KEY
    ? new OpenAIAdapter({
        apiKey: process.env.OPENAI_API_KEY,
        model: process.env.OPENAI_MODEL,
      })
    : new MockLlmAdapter();

  // Use SkillManager to load and register all skills
  const skillManager = new SkillManager(llm);
  const skillRegistry = await skillManager.loadAllSkills();

  const agentLoop = new AgentLoop({
    llm,
    memoryManager,
    toolRegistry,
    skillRegistry,
  });

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
        (m) => m.role === "user" || m.role === "assistant",
      );
      res.json(session);
    } catch (e) {
      res.status(404).json({ error: "Session not found" });
    }
  });

  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`UI server running at http://localhost:${port}`);
  });
}

main();
