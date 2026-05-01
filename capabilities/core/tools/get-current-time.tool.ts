import type { Tool, ToolContext } from "../../../common/interfaces/types.js";

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

export class GetCurrentTimeTool implements Tool {
  name = "get_current_time";
  description = "Get current date/time for a specific IANA timezone.";

  async run(input: Record<string, unknown>, _context: ToolContext): Promise<unknown> {
    const timeZoneRaw = input.timeZone;
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
