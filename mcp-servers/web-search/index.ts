import "dotenv/config";
import { createMcpServer } from "../create-mcp-server.js";
import { FetchWebpageTool } from "./tools/fetch-webpage.tool.js";
import { WebSearchTool } from "./tools/web-search.tool.js";

await createMcpServer("web-search", [
  new WebSearchTool(),
  new FetchWebpageTool(),
]);
