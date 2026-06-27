import "dotenv/config";
import { createMcpServer } from "../create-mcp-server.js";
import { DeleteCronJobTool } from "./tools/delete-cron-job.tool.js";
import { ListCronJobsTool } from "./tools/list-cron-jobs.tool.js";
import { UpsertCronJobTool } from "./tools/upsert-cron-job.tool.js";

await createMcpServer("scheduler", [
  new UpsertCronJobTool(),
  new ListCronJobsTool(),
  new DeleteCronJobTool(),
]);
