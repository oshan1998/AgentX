import "../mcp-stdio-bootstrap.js";
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serveToolsOverStdio } from "../mcp-tool-harness.js";
import { loadCapabilityTools } from "../load-capability-tools.js";
import { logger } from "../../common/services/logger.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const integrationsRoot = path.resolve(here, "../../integrations");

async function main() {
  const tools = [
    ...(await loadCapabilityTools(path.join(integrationsRoot, "web-search", "tools"))),
    ...(await loadCapabilityTools(path.join(integrationsRoot, "unsplash", "tools"))),
  ];
  await serveToolsOverStdio({ name: "agentx-web", version: "0.1.0", tools });
}

main().catch((e) => {
  logger.error("[web-mcp] Fatal error starting server.", {
    error: e instanceof Error ? e.message : String(e),
  });
  process.exit(1);
});
