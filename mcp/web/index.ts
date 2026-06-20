import "../_harness/mcp-stdio-bootstrap.js";
import "dotenv/config";
import { serveToolsOverStdio } from "../_harness/mcp-tool-harness.js";
import { loadCapabilityTools } from "../_harness/load-capability-tools.js";
import { logger } from "../_shared/logger.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const tools = await loadCapabilityTools(path.join(here, "tools"));
  await serveToolsOverStdio({ name: "agentx-web", version: "0.1.0", tools });
}

main().catch((e) => {
  logger.error("[web-mcp] Fatal error starting server.", {
    error: e instanceof Error ? e.message : String(e),
  });
  process.exit(1);
});
