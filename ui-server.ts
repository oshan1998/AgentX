import express from "express";
import path from "node:path";
import { AgentLoop } from "./core/agent-loop.js";
import { loadConfigSkills } from "./core/config-skill-runner.js";
import { OpenAIAdapter } from "./core/llm-adapter.js";
import { MemoryManager } from "./core/memory-manager.js";
import { MockLlmAdapter } from "./core/mock-llm-adapter.js";
import { SkillRegistry, ToolRegistry } from "./interfaces/registry.js";
import { ListDirectoryTool } from "./connectors/filesystem/tools/list-directory.tool.js";
import { ReadFileTool } from "./connectors/filesystem/tools/read-file.tool.js";
import { WriteFileTool } from "./connectors/filesystem/tools/write-file.tool.js";
import { AskUserTool } from "./tools/ask-user.tool.js";
import { SearchMemoryTool } from "./tools/search-memory.tool.js";
import fs from "node:fs/promises";

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

  const toolRegistry = new ToolRegistry();
  toolRegistry.register(new ReadFileTool());
  toolRegistry.register(new WriteFileTool());
  toolRegistry.register(new ListDirectoryTool());
  toolRegistry.register(new AskUserTool());
  toolRegistry.register(new SearchMemoryTool(memoryManager));

  const skillRegistry = new SkillRegistry();
  const llm = process.env.OPENAI_API_KEY
    ? new OpenAIAdapter({
        apiKey: process.env.OPENAI_API_KEY,
        model: process.env.OPENAI_MODEL
      })
    : new MockLlmAdapter();

  const globalSkills = await loadConfigSkills(path.join(process.cwd(), "skills"), llm);
  const filesystemConnectorSkills = await loadConfigSkills(
    path.join(process.cwd(), "connectors", "filesystem", "skills"),
    llm
  );
  for (const configSkill of [...globalSkills, ...filesystemConnectorSkills]) {
    skillRegistry.register(configSkill);
  }

  const agentLoop = new AgentLoop({
    llm,
    memoryManager,
    toolRegistry,
    skillRegistry
  });

  // Chat API
  app.post("/api/chat", async (req, res) => {
    const { message, sessionId } = req.body;
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Missing message" });
    }
    // Accept sessionId from client, fallback to web-session
    const sid = typeof sessionId === "string" && sessionId.length > 0 ? sessionId : "web-session";
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
      const sessions = files.filter(f => f.endsWith(".json")).map(f => f.replace(/\.json$/, ""));
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
