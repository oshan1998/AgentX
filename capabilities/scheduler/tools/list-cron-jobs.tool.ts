import path from "node:path";
import type { Tool, ToolContext } from "../../../interfaces/types.js";
import { readCronJobs } from "../scheduler-utils.js";

export class ListCronJobsTool implements Tool {
  name = "list_cron_jobs";
  description = "List saved cron job definitions.";

  async run(_input: Record<string, unknown>, _context: ToolContext): Promise<unknown> {
    const storePath = path.join(process.cwd(), "memory", "cron-jobs.json");
    return await readCronJobs(storePath);
  }
}
