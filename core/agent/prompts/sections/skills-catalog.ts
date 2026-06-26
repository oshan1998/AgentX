import type { SkillRegistry } from "../../../../common/interfaces/registry.js";
import type { Skill } from "../../../../common/interfaces/types.js";
import { SkillType } from "../../../../common/interfaces/types.js";
import { formatInputSchemaForPrompt } from "../../../../common/services/format-input-schema.js";

function formatSkillLine(s: Skill): string {
  const tag = s.kind === SkillType.Agentic ? SkillType.Agentic : SkillType.Workflow;
  const head = `- ${s.name} [${tag}]${s.description ? `: ${s.description}` : ""}`;
  const schema = formatInputSchemaForPrompt(s.inputSchema);
  return schema ? `${head}\n${schema}` : head;
}

export function skillsCatalog(skillRegistry: SkillRegistry): string {
  const list =
    skillRegistry
      .list()
      .map((s) => formatSkillLine(s))
      .join("\n\n") || "none";

  return `==================================================
AVAILABLE SKILLS
==================================================

[workflow] = step runner  [agentic] = specialist sub-agent

${list}`;
}
