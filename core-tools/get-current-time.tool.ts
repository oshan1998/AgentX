import { z } from "zod";
import type { Tool, ToolContext } from "../common/interfaces/types.js";
import { parseToolInput, zodSchemaToJsonInputSchema } from "../common/services/zod-tool-schema.js";

function normalizeTimeZone(value: string): string {
  return value.trim();
}

function buildFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  });
}

export const getCurrentTimeInputSchema = z
  .object({
    timeZone: z
      .string()
      .optional()
      .describe("IANA zone e.g. America/New_York; defaults to UTC."),
  })
  .describe("All fields optional; omit or use {} for UTC.");

export type GetCurrentTimeInput = z.infer<typeof getCurrentTimeInputSchema>;

export class GetCurrentTimeTool implements Tool {
  name = "get_current_time";
  description = "Return the current date and time for a given IANA timezone (e.g. Asia/Colombo, America/New_York).";
  inputSchema = zodSchemaToJsonInputSchema(getCurrentTimeInputSchema);

  async run(input: Record<string, unknown>, _context: ToolContext): Promise<unknown> {
    const { timeZone: timeZoneRaw } = parseToolInput(this.name, getCurrentTimeInputSchema, input);
    const timeZone =
      typeof timeZoneRaw === "string" && timeZoneRaw.trim().length > 0
        ? normalizeTimeZone(timeZoneRaw)
        : "UTC";

    let formatter: Intl.DateTimeFormat;
    try {
      formatter = buildFormatter(timeZone);
    } catch {
      throw new Error(
        `Invalid timezone: ${String(timeZone)}. Provide an IANA timezone like Asia/Colombo or UTC.`,
      );
    }

    const now = new Date();
    const localized = formatter.format(now);

    return {
      timeZone,
      localTime: localized,
      isoTime: now.toISOString(),
      epochMs: now.getTime(),
    };
  }
}
