import "dotenv/config";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { AgentLoop } from "./core/agent-loop.js";
import { OpenAIAdapter } from "./llm-adapters/llm-adapter.js";
import { MemoryManager } from "./managers/memory-manager.js";
import { MockLlmAdapter } from "./llm-adapters/mock-llm-adapter.js";
import { SchedulerRunner } from "./services/scheduler-runner.js";
import { ToolManager } from "./managers/tool-manager.js";
import { SkillManager } from "./managers/skill-manager.js";
import { logger } from "./services/logger.js";
async function bootstrap(): Promise<void> {
  const sessionId = process.env.AGENTIX_SESSION_ID ?? "default-session";
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
  const schedulerRunner = new SchedulerRunner(agentLoop);
  schedulerRunner.start();

  const rl = readline.createInterface({ input, output });
  logger.info("Agentix CLI started.");
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
  schedulerRunner.stop();
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`Fatal error: ${message}`);
  output.write(`Fatal error: ${message}\n`);
  process.exitCode = 1;
});
