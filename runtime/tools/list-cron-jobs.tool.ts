import path from "node:path";
import { z } from "zod";
import type { Tool, ToolContext } from "../../common/interfaces/types.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../common/services/zod-tool-schema.js";
import { readCronJobs } from "../services/scheduler-utils.js";

export const listCronJobsInputSchema = z
  .object({})
  .passthrough()
  .describe("No arguments required.");

export class ListCronJobsTool implements Tool {
  name = "list_cron_jobs";
  description = "List saved cron job definitions.";
  inputSchema = zodSchemaToJsonInputSchema(listCronJobsInputSchema);

  async run(input: Record<string, unknown>, _context: ToolContext): Promise<unknown> {
    parseToolInput(this.name, listCronJobsInputSchema, input);
    const storePath = path.join(process.cwd(), "memory", "cron-jobs.json");
    return await readCronJobs(storePath);
  }
}
