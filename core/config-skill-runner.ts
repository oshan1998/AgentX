import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LlmAdapter, LongTermMemoryType, Skill, SkillContext } from "../interfaces/types.js";

type SkillStep =
  | {
      type: "tool_call";
      tool: string;
      input?: Record<string, unknown>;
      saveAs?: string;
    }
  | {
      type: "llm";
      promptTemplate: string;
      saveAs?: string;
    }
  | {
      type: "memory_write";
      memoryType?: LongTermMemoryType;
      memoryTypeTemplate?: string;
      contentTemplate: string;
    }
  | {
      type: "respond";
      messageTemplate: string;
    }
  | {
      type: "profile_write";
      target: "soul" | "user";
      contentTemplate: string;
    };

interface SkillConfig {
  schemaVersion: "1";
  name: string;
  description: string;
  steps: SkillStep[];
}

export class ConfigSkill implements Skill {
  name: string;
  description: string;

  constructor(
    private readonly config: SkillConfig,
    private readonly promptMarkdown: string,
    private readonly llm: LlmAdapter
  ) {
    this.name = config.name;
    this.description = config.description;
  }

  async run(input: Record<string, unknown>, context: SkillContext): Promise<unknown> {
    const state: Record<string, unknown> = { input };

    for (const step of this.config.steps) {
      if (step.type === "tool_call") {
        const toolInput = this.resolveRecordTemplate(step.input ?? {}, state);
        const result = await context.runTool(step.tool, toolInput);
        if (step.saveAs) {
          state[step.saveAs] = result;
        } else {
          state.lastResult = result;
        }
        continue;
      }

      if (step.type === "llm") {
        const prompt = this.buildPrompt(step.promptTemplate, state);
        const output = await this.llm.complete(prompt);
        if (step.saveAs) {
          state[step.saveAs] = output;
        } else {
          state.lastResult = output;
        }
        continue;
      }

      if (step.type === "memory_write") {
        const content = this.interpolate(step.contentTemplate, state);
        const memoryType = this.resolveMemoryType(step, state);
        await context.writeMemory({
          type: memoryType,
          content,
          sourceSessionId: context.sessionId
        });
        continue;
      }

      if (step.type === "respond") {
        return this.interpolate(step.messageTemplate, state);
      }

      if (step.type === "profile_write") {
        const contentRaw = this.interpolate(step.contentTemplate, state);
        let content: Record<string, unknown>;
        try {
          content = JSON.parse(contentRaw);
        } catch (e) {
          throw new Error(`Failed to parse profile_write content as JSON: ${contentRaw}`);
        }
        await context.writeProfile(step.target, content);
        continue;
      }
    }

    return state.lastResult ?? "Skill completed.";
  }

  private buildPrompt(promptTemplate: string, state: Record<string, unknown>): string {
    const renderedPrompt = this.interpolate(promptTemplate, state);
    return [
      "Skill Instructions:",
      this.promptMarkdown,
      "",
      "Task Input:",
      renderedPrompt
    ].join("\n");
  }

  private resolveRecordTemplate(
    value: Record<string, unknown>,
    state: Record<string, unknown>
  ): Record<string, unknown> {
    const output: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value)) {
      if (typeof raw === "string") {
        output[key] = this.interpolate(raw, state);
      } else {
        output[key] = raw;
      }
    }
    return output;
  }

  private interpolate(template: string, state: Record<string, unknown>): string {
    return template.replace(/\{\{([^}]+)\}\}/g, (_all, key) => {
      const value = this.getPathValue(state, key.trim());
      if (value === undefined || value === null) {
        return "";
      }
      if (typeof value === "string") {
        return value;
      }
      return JSON.stringify(value);
    });
  }

  private getPathValue(state: Record<string, unknown>, pathString: string): unknown {
    const parts = pathString.split(".");
    let current: unknown = state;
    for (const part of parts) {
      if (!current || typeof current !== "object" || !(part in current)) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  private resolveMemoryType(
    step: Extract<SkillStep, { type: "memory_write" }>,
    state: Record<string, unknown>
  ): LongTermMemoryType {
    if (step.memoryType) {
      return step.memoryType;
    }
    if (step.memoryTypeTemplate) {
      const rendered = this.interpolate(step.memoryTypeTemplate, state).trim();
      if (rendered === "user_preference" || rendered === "behavior_rule" || rendered === "fact") {
        return rendered;
      }
      throw new Error(
        `Invalid memory type from template: ${rendered}. Expected user_preference|behavior_rule|fact.`
      );
    }
    throw new Error("memory_write step requires memoryType or memoryTypeTemplate.");
  }
}

export async function loadConfigSkills(skillDir: string, llm: LlmAdapter): Promise<ConfigSkill[]> {
  const { readdir } = await import("node:fs/promises");
  let dirEntries;
  try {
    dirEntries = await readdir(skillDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const skillFolders = dirEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const loaded: ConfigSkill[] = [];

  for (const folderName of skillFolders) {
    const skillPath = path.join(skillDir, folderName);
    const jsonPath = path.join(skillPath, "skill.json");
    const raw = await readFile(jsonPath, "utf-8");
    const config = parseSkillConfig(JSON.parse(raw), `${folderName}/skill.json`);
    const promptPath = path.join(skillPath, "prompt.md");
    let promptMarkdown = "You are a helpful assistant.";
    try {
      promptMarkdown = await readFile(promptPath, "utf-8");
    } catch {
      // optional prompt file; fallback used
    }
    loaded.push(new ConfigSkill(config, promptMarkdown, llm));
  }

  return loaded;
}

function parseSkillConfig(value: unknown, sourceName: string): SkillConfig {
  if (!value || typeof value !== "object") {
    throw new Error(`Invalid skill config in ${sourceName}: expected object.`);
  }
  const obj = value as Record<string, unknown>;
  if (obj.schemaVersion !== "1") {
    throw new Error(`Invalid skill config in ${sourceName}: schemaVersion must be "1".`);
  }
  if (typeof obj.name !== "string" || obj.name.length === 0) {
    throw new Error(`Invalid skill config in ${sourceName}: missing name.`);
  }
  if (typeof obj.description !== "string" || obj.description.length === 0) {
    throw new Error(`Invalid skill config in ${sourceName}: missing description.`);
  }
  if (!Array.isArray(obj.steps)) {
    throw new Error(`Invalid skill config in ${sourceName}: steps must be an array.`);
  }
  return obj as unknown as SkillConfig;
}
