import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LlmAdapter, Skill } from "../common/interfaces/types.js";
import {
  type AgenticSkillConfig,
  AgenticSkill,
  parseAgenticSkillJson,
} from "./agentic-skill-runner.js";
import {
  type WorkflowSkillConfig,
  WorkflowSkill,
  parseWorkflowSkillJson,
} from "./workflow-skill-runner.js";

/**
 * Load all skills from a directory of skill folders (`each/skill.json` + optional `prompt.md`).
 * Dispatches to workflow vs agentic runners based on `kind` in `skill.json`.
 */
export async function loadSkillsFromDirectory(skillDir: string, llm: LlmAdapter): Promise<Skill[]> {
  const { readdir } = await import("node:fs/promises");
  let dirEntries;
  try {
    dirEntries = await readdir(skillDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const skillFolders = dirEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const loaded: Skill[] = [];

  for (const folderName of skillFolders) {
    const skillPath = path.join(skillDir, folderName);
    const jsonPath = path.join(skillPath, "skill.json");
    const raw = await readFile(jsonPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const config = parseSkillJson(parsed, `${folderName}/skill.json`);
    let promptMarkdown = "You are a helpful assistant.";
    const promptPath = path.join(skillPath, "prompt.md");
    try {
      promptMarkdown = await readFile(promptPath, "utf-8");
    } catch {
      // optional prompt file; fallback used
    }
    if (config.kind === "agentic") {
      loaded.push(new AgenticSkill(config, promptMarkdown));
    } else {
      loaded.push(new WorkflowSkill(config, promptMarkdown, llm));
    }
  }

  return loaded;
}

function parseSkillJson(
  value: unknown,
  sourceName: string,
): WorkflowSkillConfig | AgenticSkillConfig {
  if (!value || typeof value !== "object") {
    throw new Error(`Invalid skill config in ${sourceName}: expected object.`);
  }
  const obj = value as Record<string, unknown>;
  if (obj.schemaVersion !== "1") {
    throw new Error(`Invalid skill config in ${sourceName}: schemaVersion must be "1".`);
  }
  if (obj.kind === "agentic") {
    return parseAgenticSkillJson(obj, sourceName);
  }
  return parseWorkflowSkillJson(obj, sourceName);
}
