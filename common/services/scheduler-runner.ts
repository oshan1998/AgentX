import path from "node:path";
import { logger } from "./logger.js";
import { AgentLoop } from "../../core/agent/agent-loop.js";
import {
  readCronJobs,
  writeCronJobs,
} from "../../mcp-servers/scheduler/scheduler-utils.js";

function minuteKeyUtc(date: Date): string {
  const iso = date.toISOString();
  return iso.slice(0, 16);
}

function isCronTokenMatch(token: string, value: number): boolean {
  const part = token.trim();
  if (part === "*") {
    return true;
  }
  if (part.includes(",")) {
    return part.split(",").some((t) => isCronTokenMatch(t, value));
  }
  if (part.includes("/")) {
    const [base, stepRaw] = part.split("/");
    const step = Number(stepRaw);
    if (!Number.isInteger(step) || step <= 0) {
      return false;
    }
    if (base === "*") {
      return value % step === 0;
    }
    if (base.includes("-")) {
      const [startRaw, endRaw] = base.split("-");
      const start = Number(startRaw);
      const end = Number(endRaw);
      if (!Number.isInteger(start) || !Number.isInteger(end)) {
        return false;
      }
      if (value < start || value > end) {
        return false;
      }
      return (value - start) % step === 0;
    }
    return false;
  }
  if (part.includes("-")) {
    const [startRaw, endRaw] = part.split("-");
    const start = Number(startRaw);
    const end = Number(endRaw);
    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      return false;
    }
    return value >= start && value <= end;
  }
  const exact = Number(part);
  return Number.isInteger(exact) && exact === value;
}

function isCronDue(schedule: string, now: Date): boolean {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) {
    return false;
  }
  const [min, hour, day, month, weekday] = parts;
  return (
    isCronTokenMatch(min, now.getUTCMinutes()) &&
    isCronTokenMatch(hour, now.getUTCHours()) &&
    isCronTokenMatch(day, now.getUTCDate()) &&
    isCronTokenMatch(month, now.getUTCMonth() + 1) &&
    isCronTokenMatch(weekday, now.getUTCDay())
  );
}

export class SchedulerRunner {
  private timer: ReturnType<typeof setInterval> | undefined;
  private isTicking = false;
  private readonly storePath = path.join(
    process.cwd(),
    "memory",
    "cron-jobs.json",
  );

  constructor(
    private readonly agentLoop: AgentLoop,
    private readonly intervalMs: number = 30_000,
  ) {}

  start(): void {
    if (this.timer) {
      return;
    }
    logger.info("Starting scheduler runner...");
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
  }

  stop(): void {
    if (!this.timer) {
      return;
    }
    logger.info("Stopping scheduler runner...");
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private async tick(): Promise<void> {
    if (this.isTicking) {
      return;
    }
    this.isTicking = true;

    try {
      // get UTC now time
      const now = new Date();
      const minuteKey = minuteKeyUtc(now);
      const jobs = await readCronJobs(this.storePath);
      let dirty = false;

      for (const job of jobs) {
        if (!job.enabled) {
          continue;
        }
        if (!isCronDue(job.schedule, now)) {
          continue;
        }
        if (job.lastRunMinute === minuteKey) {
          continue;
        }

        const sessionId = `cron-${job.id}`;
        try {
          logger.info(`Executing cron job: ${job.name}`, {
            id: job.id,
            task: job.task,
          });
          await this.agentLoop.handleUserInput(sessionId, job.task);
          job.lastStatus = "success";
          job.lastError = undefined;
          logger.info(`Cron job executed successfully: ${job.name}`);
        } catch (error) {
          job.lastStatus = "error";
          job.lastError =
            error instanceof Error ? error.message : String(error);
          logger.error(`Cron job failed: ${job.name}`, {
            error: job.lastError,
          });
        }
        job.lastRunAt = new Date().toISOString();
        job.lastRunMinute = minuteKey;
        job.updatedAt = new Date().toISOString();
        dirty = true;
      }

      if (dirty) {
        await writeCronJobs(this.storePath, jobs);
      }
    } finally {
      this.isTicking = false;
    }
  }
}
