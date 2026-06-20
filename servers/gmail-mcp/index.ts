import "../mcp-stdio-bootstrap.js";
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serveToolsOverStdio } from "../mcp-tool-harness.js";
import { loadCapabilityTools } from "../load-capability-tools.js";
import { logger } from "../../common/services/logger.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const gmailToolsDir = path.resolve(here, "../../integrations/gmail/tools");

async function main() {
  const tools = await loadCapabilityTools(gmailToolsDir);
  await serveToolsOverStdio({ name: "agentx-gmail", version: "0.1.0", tools });
}

main().catch((e) => {
  logger.error("[gmail-mcp] Fatal error starting server.", {
    error: e instanceof Error ? e.message : String(e),
  });
  process.exit(1);
});
