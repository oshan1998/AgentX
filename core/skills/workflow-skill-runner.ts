import {
  SkillStepType,
  type JsonInputSchema,
  type LlmAdapter,
  type LongTermMemoryType,
  type Skill,
  type SkillContext,
  type SkillStep,
} from "../../common/interfaces/types.js";
import { SkillType } from "../../common/interfaces/types.js";
export interface WorkflowSkillConfig {
  schemaVersion: "1";
  kind?: SkillType.Workflow;
  name: string;
  description: string;
  steps: SkillStep[];
  inputSchema?: JsonInputSchema;
}

/**
 * Step-based skills: `tool_call`, `llm` (with optional `prompt.md` as LLM system context), `memory_write`, `respond`, `profile_write`.
 */
export class WorkflowSkill implements Skill {
  name: string;
  description: string;
  readonly inputSchema?: JsonInputSchema;
  readonly kind= SkillType.Workflow


  constructor(
    private readonly config: WorkflowSkillConfig,
    private readonly promptMarkdown: string,
    private readonly llm: LlmAdapter,
  ) {
    this.name = config.name;
    this.description = config.description;
    this.inputSchema = config.inputSchema;
  }

  getPromptMarkdown(): string {
    return this.promptMarkdown;
  }

  async run(input: Record<string, unknown>, context: SkillContext): Promise<unknown> {
    const state: Record<string, unknown> = { input };

    for (const step of this.config.steps) {
      if (step.type === SkillStepType.ToolCall) {
        const toolInput = this.resolveRecordTemplate(step.input ?? {}, state);
        const result = await context.runTool(step.tool, toolInput);
        if (step.saveAs) {
          state[step.saveAs] = result;
        } else {
          state.lastResult = result;
        }
        continue;
      }

      if (step.type === SkillStepType.Llm) {
        const prompt = this.interpolate(step.promptTemplate, state);
        const raw = await this.llm.complete(prompt, this.promptMarkdown);
        let output: unknown = raw;
        if (step.parseOutputAsJson) {
          output = this.parseLooseJson(raw, "llm step output");
          if (!output || typeof output !== "object" || Array.isArray(output)) {
            throw new Error("llm step with parseOutputAsJson expected a JSON object.");
          }
        }
        if (step.saveAs) {
          state[step.saveAs] = output;
        } else {
          state.lastResult = output;
        }
        continue;
      }

      if (step.type === SkillStepType.MemoryWrite) {
        const content = this.interpolate(step.contentTemplate, state);
        const memoryType = this.resolveMemoryType(step, state);
        await context.writeMemory({
          type: memoryType,
          content,
          sourceSessionId: context.sessionId,
        });
        continue;
      }

      if (step.type === SkillStepType.Respond) {
        return this.interpolate(step.messageTemplate, state);
      }

      if (step.type === SkillStepType.ProfileWrite) {
        const contentRaw = this.interpolate(step.contentTemplate, state);
        let content: Record<string, unknown>;
        try {
          content = JSON.parse(contentRaw);
        } catch {
          throw new Error(`Failed to parse profile_write content as JSON: ${contentRaw}`);
        }
        await context.writeProfile(step.target, content);
        continue;
      }
    }

    return state.lastResult ?? "Skill completed.";
  }

  private resolveRecordTemplate(
    value: Record<string, unknown>,
    state: Record<string, unknown>,
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

  private parseLooseJson(raw: string, contextLabel: string): unknown {
    const trimmed = raw.trim();
    try {
      return JSON.parse(trimmed);
    } catch {
      const first = trimmed.indexOf("{");
      const last = trimmed.lastIndexOf("}");
      if (first === -1 || last === -1 || last <= first) {
        throw new Error(`${contextLabel} was not valid JSON: ${trimmed.slice(0, 200)}`);
      }
      try {
        return JSON.parse(trimmed.slice(first, last + 1));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`${contextLabel} JSON parse failed: ${msg}`);
      }
    }
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
    state: Record<string, unknown>,
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
        `Invalid memory type from template: ${rendered}. Expected user_preference|behavior_rule|fact.`,
      );
    }
    throw new Error("memory_write step requires memoryType or memoryTypeTemplate.");
  }
}

export function parseWorkflowSkillJson(
  obj: Record<string, unknown>,
  sourceName: string,
): WorkflowSkillConfig {
  if (obj.kind !== undefined && obj.kind !== "workflow") {
    throw new Error(`Invalid workflow skill in ${sourceName}: unknown kind "${String(obj.kind)}".`);
  }
  if (typeof obj.name !== "string" || obj.name.length === 0) {
    throw new Error(`Invalid workflow skill in ${sourceName}: missing name.`);
  }
  if (typeof obj.description !== "string" || obj.description.length === 0) {
    throw new Error(`Invalid workflow skill in ${sourceName}: missing description.`);
  }
  if (!Array.isArray(obj.steps)) {
    throw new Error(`Invalid workflow skill in ${sourceName}: steps must be an array.`);
  }
  if ("inputSchema" in obj && obj.inputSchema !== undefined && obj.inputSchema !== null) {
    if (typeof obj.inputSchema !== "object" || Array.isArray(obj.inputSchema)) {
      throw new Error(
        `Invalid workflow skill in ${sourceName}: inputSchema must be a plain object when present.`,
      );
    }
  }
  return obj as unknown as WorkflowSkillConfig;
}
