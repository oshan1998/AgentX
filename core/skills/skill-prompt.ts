import type { Skill } from "../../common/interfaces/types.js";
import { AgenticSkill } from "./agentic-skill-runner.js";
import { WorkflowSkill } from "./workflow-skill-runner.js";

/** Returns skill `prompt.md` content when the skill implementation exposes it. */
export function getSkillPromptMarkdown(skill: Skill): string | undefined {
  if (skill instanceof AgenticSkill || skill instanceof WorkflowSkill) {
    const markdown = skill.getPromptMarkdown().trim();
    return markdown.length > 0 ? markdown : undefined;
  }
  return undefined;
}
