import "dotenv/config";
import { createMcpServer } from "../create-mcp-server.js";
import { GenerateDesignedPdfTool } from "./tools/generate-designed-pdf.tool.js";
import { ReadPdfTool } from "./tools/read-pdf.tool.js";

await createMcpServer("pdf", [
  new ReadPdfTool(),
  new GenerateDesignedPdfTool(),
]);
