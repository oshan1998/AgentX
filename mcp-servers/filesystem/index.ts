import "dotenv/config";
import { createMcpServer } from "../create-mcp-server.js";
import { DownloadFileTool } from "./tools/download-file.tool.js";
import { ListDirectoryTool } from "./tools/list-directory.tool.js";
import { ReadFileTool } from "./tools/read-file.tool.js";
import { WriteFileTool } from "./tools/write-file.tool.js";

await createMcpServer("filesystem", [
  new ReadFileTool(),
  new WriteFileTool(),
  new ListDirectoryTool(),
  new DownloadFileTool(),
]);
