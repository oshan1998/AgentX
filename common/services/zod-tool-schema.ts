import { z, type ZodError, type ZodType } from "zod";
import type { JsonInputSchema } from "../interfaces/types.js";

/**
 * Converts a Zod schema to a JSON Schema fragment suitable for
 * {@link formatInputSchemaForPrompt} and `Tool.inputSchema`.
 *
 * Uses Zod 4's native `z.toJSONSchema()` — the external `zod-to-json-schema`
 * 3.x package is incompatible with Zod 4 and produces empty schemas.
 */
export function zodSchemaToJsonInputSchema(schema: ZodType): JsonInputSchema {
  return z.toJSONSchema(schema) as JsonInputSchema;
}

function formatZodError(error: ZodError): string {
  return error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
}

/**
 * Validates tool input inside `Tool.run` so direct callers are safe too.
 */
export function parseToolInput<T>(toolName: string, schema: ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`${toolName}: invalid input — ${formatZodError(parsed.error)}`);
  }
  return parsed.data;
}
