import "dotenv/config";
import { createMcpServer } from "../create-mcp-server.js";
import { ListEmailsTool } from "./tools/list-emails.tool.js";
import { ReadEmailTool } from "./tools/read-email.tool.js";
import { SearchEmailsTool } from "./tools/search-emails.tool.js";

await createMcpServer("gmail", [
  new ListEmailsTool(),
  new SearchEmailsTool(),
  new ReadEmailTool(),
]);
