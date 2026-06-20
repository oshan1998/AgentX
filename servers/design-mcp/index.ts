import "../mcp-stdio-bootstrap.js";
import "dotenv/config";
import { serveToolsOverStdio } from "../mcp-tool-harness.js";
import { createDesignTools } from "./tools.js";
import { logger } from "../../common/services/logger.js";

async function main() {
  await serveToolsOverStdio({
    name: "agentx-design",
    version: "0.1.0",
    tools: createDesignTools(),
  });
}

main().catch((e) => {
  logger.error("[design-mcp] Fatal error starting server.", {
    error: e instanceof Error ? e.message : String(e),
  });
  process.exit(1);
});
