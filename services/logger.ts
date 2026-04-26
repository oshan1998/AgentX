import { appendFile } from "node:fs/promises";
import path from "node:path";

class LoggerService {
  private readonly logFilePath: string;

  constructor() {
    this.logFilePath = path.join(process.cwd(), "server.log");
  }

  private async persist(level: string, message: string, meta?: any): Promise<void> {
    try {
      const timestamp = new Date().toISOString();
      const metaString = meta ? ` ${JSON.stringify(meta)}` : "";
      const logLine = `[${timestamp}] [${level.toUpperCase()}] ${message}${metaString}\n`;
      await appendFile(this.logFilePath, logLine, "utf-8");
    } catch (err) {
      console.error("Failed to write to server.log", err);
    }
  }

  info(message: string, meta?: any): void {
    console.log(`[INFO] ${message}`, meta ? meta : "");
    void this.persist("info", message, meta);
  }

  error(message: string, meta?: any): void {
    console.error(`[ERROR] ${message}`, meta ? meta : "");
    void this.persist("error", message, meta);
  }

  warn(message: string, meta?: any): void {
    console.warn(`[WARN] ${message}`, meta ? meta : "");
    void this.persist("warn", message, meta);
  }

  debug(message: string, meta?: any): void {
    console.debug(`[DEBUG] ${message}`, meta ? meta : "");
    void this.persist("debug", message, meta);
  }
}

export const logger = new LoggerService();
