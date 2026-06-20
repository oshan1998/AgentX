import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface CronJobRecord {
  id: string;
  name: string;
  schedule: string;
  task: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastRunMinute?: string;
  lastStatus?: "success" | "error";
  lastError?: string;
}

export async function readCronJobs(storePath: string): Promise<CronJobRecord[]> {
  try {
    const raw = await readFile(storePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is CronJobRecord => {
      if (!item || typeof item !== "object") {
        return false;
      }
      const obj = item as Record<string, unknown>;
      return (
        typeof obj.id === "string" &&
        typeof obj.name === "string" &&
        typeof obj.schedule === "string" &&
        typeof obj.task === "string" &&
        typeof obj.enabled === "boolean" &&
        typeof obj.createdAt === "string" &&
        typeof obj.updatedAt === "string" &&
        (obj.lastRunAt === undefined || typeof obj.lastRunAt === "string") &&
        (obj.lastRunMinute === undefined || typeof obj.lastRunMinute === "string") &&
        (obj.lastStatus === undefined ||
          obj.lastStatus === "success" ||
          obj.lastStatus === "error") &&
        (obj.lastError === undefined || typeof obj.lastError === "string")
      );
    });
  } catch {
    return [];
  }
}

export async function writeCronJobs(storePath: string, jobs: CronJobRecord[]): Promise<void> {
  const dir = path.dirname(storePath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(storePath, JSON.stringify(jobs, null, 2), "utf-8");
}
