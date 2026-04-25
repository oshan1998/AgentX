import "dotenv/config";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
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

async function bootstrap(): Promise<void> {
  const sessionId = process.env.AGENTIX_SESSION_ID ?? "default-session";
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

  const rl = readline.createInterface({ input, output });
  output.write("Agentix CLI started. Type 'exit' to quit.\n");

  while (true) {
    const userInput = await rl.question("You> ");
    if (userInput.trim().toLowerCase() === "exit") {
      break;
    }
    const response = await agentLoop.handleUserInput(sessionId, userInput);
    output.write(`Agentix> ${response}\n`);
  }

  rl.close();
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  output.write(`Fatal error: ${message}\n`);
  process.exitCode = 1;
});
