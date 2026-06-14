import type { JsonInputSchema } from "../interfaces/types.js";

/**
 * Turns a compact JSON Schema fragment into planner-readable indented lines (no markdown code fences).
 */
export function formatInputSchemaForPrompt(schema?: JsonInputSchema): string {
  if (!schema || typeof schema !== "object") {
    return "";
  }

  const rootDesc = typeof schema.description === "string" ? schema.description.trim() : "";
  const schemaType = typeof schema.type === "string" ? schema.type : "";

  const requiredRaw = schema.required;
  const required =
    Array.isArray(requiredRaw) && requiredRaw.every((x) => typeof x === "string")
      ? (requiredRaw as string[])
      : [];

  const props = schema.properties;

  const lines: string[] = [];

  if (schemaType === "object" && props !== undefined && props !== null && typeof props === "object" && !Array.isArray(props)) {
    const propEntries = Object.entries(props as Record<string, unknown>);
    lines.push("  input:");
    if (rootDesc) {
      lines.push(`    ${rootDesc}`);
    }
    if (required.length > 0) {
      lines.push(`    Required keys: ${required.join(", ")}`);
    } else if (propEntries.length === 0 && !rootDesc) {
      lines.push("    Empty object {} is valid.");
    }
    if (propEntries.length > 0) {
      lines.push("    Properties:");
      for (const [key, sub] of propEntries) {
        const marker = required.includes(key) ? "required" : "optional";
        if (sub && typeof sub === "object" && !Array.isArray(sub)) {
          const field = sub as Record<string, unknown>;
          const t = typeof field.type === "string" ? field.type : "any";
          const d = typeof field.description === "string" ? ` — ${field.description}` : "";
          lines.push(`      - ${key} (${marker}, ${typeLabel(t)})${d}`);
        } else {
          lines.push(`      - ${key} (${marker})`);
        }
      }
    }
    return lines.join("\n");
  }

  lines.push(`  input schema (JSON Schema):`);
  lines.push(...JSON.stringify(schema, null, 2).split("\n").map((l) => `    ${l}`));
  return lines.join("\n");
}

function typeLabel(t: string): string {
  switch (t) {
    case "string":
      return "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "object":
      return "object";
    case "array":
      return "array";
    default:
      return t;
  }
}
