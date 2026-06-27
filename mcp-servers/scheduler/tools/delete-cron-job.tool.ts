import path from "node:path";
import { z } from "zod";
import type { Tool, ToolContext } from "../../../common/interfaces/types.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../../common/services/zod-tool-schema.js";
import { readCronJobs, writeCronJobs } from "../scheduler-utils.js";

export const deleteCronJobInputSchema = z.object({
  id: z.string().min(1).describe("Cron job id to remove."),
});

export type DeleteCronJobInput = z.infer<typeof deleteCronJobInputSchema>;

export class DeleteCronJobTool implements Tool {
  name = "delete_cron_job";
  description = "Delete a cron job definition by id.";
  inputSchema = zodSchemaToJsonInputSchema(deleteCronJobInputSchema);

  async run(input: Record<string, unknown>, _context: ToolContext): Promise<unknown> {
    const { id } = parseToolInput(this.name, deleteCronJobInputSchema, input);

    const storePath = path.join(process.cwd(), "memory", "cron-jobs.json");
    const jobs = await readCronJobs(storePath);

    const nextJobs = jobs.filter((job) => job.id !== id);
    const removed = nextJobs.length !== jobs.length;
    await writeCronJobs(storePath, nextJobs);

    return { success: true, removed, id };
  }
}
