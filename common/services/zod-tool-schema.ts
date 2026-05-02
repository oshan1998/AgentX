import type { ZodError, ZodType } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { JsonInputSchema } from "../interfaces/types.js";

/**
 * Converts a Zod object schema to a JSON Schema fragment suitable for
 * {@link formatInputSchemaForPrompt} and `Tool.inputSchema`.
 *
 * `zod-to-json-schema` typings target Zod 3 internals; Zod 4 schemas work at runtime — cast at this boundary only.
 */
export function zodSchemaToJsonInputSchema(schema: ZodType): JsonInputSchema {
  type ZodToJson = Parameters<typeof zodToJsonSchema>[0];
  return zodToJsonSchema(schema as unknown as ZodToJson, { $refStrategy: "none" }) as JsonInputSchema;
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
