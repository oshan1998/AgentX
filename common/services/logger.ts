import winston from "winston";
import path from "node:path";

const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaString = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaString}`;
  })
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaString = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
    return `[${timestamp}] [${level}] ${message}${metaString}`;
  })
);

class LoggerService {
  private winstonLogger: winston.Logger;

  constructor() {
    // Stdio MCP servers use stdout for the JSON-RPC channel, so console logs
    // MUST go to stderr to avoid corrupting the protocol. Opt in via
    // AGENTX_LOG_STDERR (set by stdio server bootstrap).
    const logToStderr = process.env.AGENTX_LOG_STDERR === "1";
    const consoleTransport = logToStderr
      ? new winston.transports.Stream({ stream: process.stderr, format: consoleFormat })
      : new winston.transports.Console({ format: consoleFormat });

    this.winstonLogger = winston.createLogger({
      level: "debug",
      transports: [
        new winston.transports.File({ 
          filename: path.join(process.cwd(), "server.log"),
          format: fileFormat,
        }),
        consoleTransport,
      ]
    });
  }

  info(message: string, meta?: any): void {
    this.winstonLogger.info(message, meta);
  }

  error(message: string, meta?: any): void {
    this.winstonLogger.error(message, meta);
  }

  warn(message: string, meta?: any): void {
    this.winstonLogger.warn(message, meta);
  }

  debug(message: string, meta?: any): void {
    this.winstonLogger.debug(message, meta);
  }
}

export const logger = new LoggerService();
