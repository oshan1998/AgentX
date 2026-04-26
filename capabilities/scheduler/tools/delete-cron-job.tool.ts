import path from "node:path";
import type { Tool, ToolContext } from "../../../interfaces/types.js";
import { readCronJobs, writeCronJobs } from "../scheduler-utils.js";

export class DeleteCronJobTool implements Tool {
  name = "delete_cron_job";
  description = "Delete a cron job definition by id.";

  async run(input: Record<string, unknown>, _context: ToolContext): Promise<unknown> {
    const id = input.id;
    if (typeof id !== "string" || id.trim().length === 0) {
      throw new Error("delete_cron_job requires { id: string }.");
    }

    const storePath = path.join(process.cwd(), "memory", "cron-jobs.json");
    const jobs = await readCronJobs(storePath);

    const nextJobs = jobs.filter((job) => job.id !== id);
    const removed = nextJobs.length !== jobs.length;
    await writeCronJobs(storePath, nextJobs);

    return { success: true, removed, id };
  }
}
