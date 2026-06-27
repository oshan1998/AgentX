import path from "node:path";
import { z } from "zod";
import type { Tool, ToolContext } from "../../../common/interfaces/types.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../../../common/services/zod-tool-schema.js";
import { readCronJobs, writeCronJobs } from "../scheduler-utils.js";

function isValidCronExpression(value: string): boolean {
  const parts = value.trim().split(/\s+/);
  return parts.length === 5;
}

function generateCronJobId(): string {
  return `cron_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export const upsertCronJobInputSchema = z.object({
  name: z.string().min(1).describe("Human-readable job label."),
  schedule: z.string().min(1).describe("Five cron fields (minute hour dom month dow)."),
  task: z.string().min(1).describe("Instruction or payload to run when triggered."),
  id: z.string().optional().describe("Existing job id for update; omit to create."),
  enabled: z
    .union([z.boolean(), z.string()])
    .optional()
    .describe("Whether the job runs; defaults true."),
});

export type UpsertCronJobInput = z.infer<typeof upsertCronJobInputSchema>;

export class UpsertCronJobTool implements Tool {
  name = "upsert_cron_job";
  description = "Create or update a cron job definition.";
  inputSchema = zodSchemaToJsonInputSchema(upsertCronJobInputSchema);

  async run(input: Record<string, unknown>, _context: ToolContext): Promise<unknown> {
    const parsed = parseToolInput(this.name, upsertCronJobInputSchema, input);
    const name = parsed.name.trim();
    const task = parsed.task.trim();
    const schedule = parsed.schedule.trim();
    const idRaw = parsed.id;
    const enabledRaw = parsed.enabled;

    if (!isValidCronExpression(schedule)) {
      throw new Error("upsert_cron_job requires { schedule: string } in 5-part cron format.");
    }

    const storePath = path.join(process.cwd(), "memory", "cron-jobs.json");
    const jobs = await readCronJobs(storePath);
    const now = new Date().toISOString();
    const id = typeof idRaw === "string" && idRaw.length > 0 ? idRaw : generateCronJobId();
    const enabled =
      typeof enabledRaw === "boolean"
        ? enabledRaw
        : typeof enabledRaw === "string"
          ? enabledRaw.trim().toLowerCase() !== "false"
          : true;

    const existingIndex = jobs.findIndex((job) => job.id === id);
    if (existingIndex >= 0) {
      const existing = jobs[existingIndex];
      jobs[existingIndex] = {
        ...existing,
        name,
        schedule,
        task,
        enabled,
        updatedAt: now,
      };
    } else {
      jobs.push({
        id,
        name,
        schedule,
        task,
        enabled,
        createdAt: now,
        updatedAt: now,
      });
    }

    await writeCronJobs(storePath, jobs);
    return jobs.find((job) => job.id === id);
  }
}
