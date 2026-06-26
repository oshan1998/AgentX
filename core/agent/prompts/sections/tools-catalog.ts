import type { ToolRegistry } from "../../../../common/interfaces/registry.js";
import { formatInputSchemaForPrompt } from "../../../../common/services/format-input-schema.js";

export function toolsCatalog(toolRegistry: ToolRegistry): string {
  const list =
    toolRegistry
      .list()
      .map((t) => {
        const head = `- ${t.name}${t.description ? `: ${t.description}` : ""}`;
        const schema = formatInputSchemaForPrompt(t.inputSchema);
        return schema ? `${head}\n${schema}` : head;
      })
      .join("\n\n") || "none";

  return `==================================================
AVAILABLE TOOLS
==================================================

${list}`;
}
