import "dotenv/config";
import { createMcpServer } from "../create-mcp-server.js";
import { SearchStockImagesTool } from "./tools/search-stock-images.tool.js";

await createMcpServer("unsplash", [
  new SearchStockImagesTool(),
]);
