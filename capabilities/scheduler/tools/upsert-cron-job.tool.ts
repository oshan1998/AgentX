import path from "node:path";
import type { Tool, ToolContext } from "../../../common/interfaces/types.js";
import { readCronJobs, writeCronJobs } from "../scheduler-utils.js";

function isValidCronExpression(value: string): boolean {
  const parts = value.trim().split(/\s+/);
  return parts.length === 5;
}



function generateCronJobId(): string {
  return `cron_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export class UpsertCronJobTool implements Tool {
  name = "upsert_cron_job";
  description = "Create or update a cron job definition.";
  inputSchema = {
    type: "object",
    properties: {
      name: { type: "string", description: "Human-readable job label." },
      schedule: {
        type: "string",
        description: "Five cron fields (minute hour dom month dow).",
      },
      task: { type: "string", description: "Instruction or payload to run when triggered." },
      id: {
        type: "string",
        description: "Existing job id for update; omit to create.",
      },
      enabled: {
        type: "boolean",
        description: "Whether the job runs; defaults true.",
      },
    },
    required: ["name", "schedule", "task"],
  } as const;

  async run(input: Record<string, unknown>, _context: ToolContext): Promise<unknown> {
    const name = input.name;
    const schedule = input.schedule;
    const task = input.task;
    const idRaw = input.id;
    const enabledRaw = input.enabled;

    if (typeof name !== "string" || name.trim().length === 0) {
      throw new Error("upsert_cron_job requires { name: string }.");
    }
    if (typeof task !== "string" || task.trim().length === 0) {
      throw new Error("upsert_cron_job requires { task: string }.");
    }
    if (typeof schedule !== "string" || !isValidCronExpression(schedule)) {
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
        name: name.trim(),
        schedule: schedule.trim(),
        task: task.trim(),
        enabled,
        updatedAt: now,
      };
    } else {
      jobs.push({
        id,
        name: name.trim(),
        schedule: schedule.trim(),
        task: task.trim(),
        enabled,
        createdAt: now,
        updatedAt: now,
      });
    }

    await writeCronJobs(storePath, jobs);
    return jobs.find((job) => job.id === id);
  }
}
