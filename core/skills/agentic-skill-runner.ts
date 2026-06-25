import type {
  JsonInputSchema,
  Skill,
  SkillContext,

} from "../../common/interfaces/types.js";
import { SkillType } from "../../common/interfaces/types.js";
export interface AgenticSkillConfig {
  schemaVersion: "1";
  kind: SkillType.Agentic;
  name: string;
  description: string;
  inputSchema?: JsonInputSchema;
  toolNames: string[];
  skillNames?: string[];
  maxIterations?: number;
  deadlineMs?: number;
  model?: string;
}

/**
 * Reads `skill.json` + `prompt.md`, then runs a delegated sub-agent with allow-listed tools/skills.
 * `prompt.md` is appended after the base sub-agent system prompt via subAgentSystemPromptAppend.
 */
export class AgenticSkill implements Skill {
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: JsonInputSchema;
  readonly kind: SkillType.Agentic = SkillType.Agentic as const;
  readonly model?: string;
  constructor(
    private readonly config: AgenticSkillConfig,
    private readonly promptMarkdown: string,
  ) {
    this.name = config.name;
    this.description = config.description;
    this.inputSchema = config.inputSchema;
    this.model = config.model;
  }

  getPromptMarkdown(): string {
    return this.promptMarkdown;
  }

  async run(input: Record<string, unknown>, context: SkillContext): Promise<unknown> {
    const delegate = context.delegateSubAgent;
    if (!delegate) {
      throw new Error(
        `Agentic skill "${this.name}" requires delegateSubAgent (not available in this runtime).`,
      );
    }
    const task = this.buildTask(input);
    const append = this.promptMarkdown.trim();
    return delegate({
      task,
      toolNames: this.config.toolNames,
      skillNames: this.config.skillNames,
      systemPromptAppend: append.length > 0 ? append : undefined,
      maxIterations: this.config.maxIterations,
      deadlineMs: this.config.deadlineMs,
      model: this.model,
    });
  }

  private buildTask(input: Record<string, unknown>): string {
    return [
      `Delegated skill: ${this.config.name}`,
      "",
      "Skill input (JSON):",
      JSON.stringify(input, null, 2),
    ].join("\n");
  }
}

export function parseAgenticSkillJson(
  obj: Record<string, unknown>,
  sourceName: string,
): AgenticSkillConfig {
  if (typeof obj.name !== "string" || obj.name.length === 0) {
    throw new Error(`Invalid agentic skill in ${sourceName}: missing name.`);
  }
  if (typeof obj.description !== "string" || obj.description.length === 0) {
    throw new Error(`Invalid agentic skill in ${sourceName}: missing description.`);
  }
  if (obj.toolNames!==undefined){
    if (!Array.isArray(obj.toolNames) || obj.toolNames.length === 0) {
    throw new Error(`Invalid agentic skill in ${sourceName}: toolNames must be a non-empty array.`);
  }
  for (const t of obj.toolNames) {
    if (typeof t !== "string" || !t.trim()) {
      throw new Error(
        `Invalid agentic skill in ${sourceName}: each toolNames entry must be a non-empty string.`,
      );
    }
  }
  }
  
  if (obj.skillNames !== undefined) {
    if (!Array.isArray(obj.skillNames)) {
      throw new Error(`Invalid agentic skill in ${sourceName}: skillNames must be an array when present.`);
    }
    for (const s of obj.skillNames) {
      if (typeof s !== "string" || !s.trim()) {
        throw new Error(
          `Invalid agentic skill in ${sourceName}: each skillNames entry must be a non-empty string.`,
        );
      }
    }
  }
  if (obj.maxIterations !== undefined) {
    if (
      typeof obj.maxIterations !== "number" ||
      !Number.isFinite(obj.maxIterations) ||
      obj.maxIterations <= 0
    ) {
      throw new Error(
        `Invalid agentic skill in ${sourceName}: maxIterations must be a positive number when set.`,
      );
    }
  }
  if (obj.deadlineMs !== undefined) {
    if (typeof obj.deadlineMs !== "number" || !Number.isFinite(obj.deadlineMs) || obj.deadlineMs <= 0) {
      throw new Error(`Invalid agentic skill in ${sourceName}: deadlineMs must be a positive number when set.`);
    }
  }
  if ("inputSchema" in obj && obj.inputSchema !== undefined && obj.inputSchema !== null) {
    if (typeof obj.inputSchema !== "object" || Array.isArray(obj.inputSchema)) {
      throw new Error(`Invalid agentic skill in ${sourceName}: inputSchema must be a plain object when present.`);
    }
  }
  return {
    schemaVersion: "1",
    kind: SkillType.Agentic,
    name: obj.name,
    description: obj.description,
    inputSchema: obj.inputSchema as JsonInputSchema | undefined,
    toolNames: obj.toolNames as string[],
    skillNames: obj.skillNames as string[] | undefined,
    maxIterations: obj.maxIterations as number | undefined,
    deadlineMs: obj.deadlineMs as number | undefined,
    model: obj.model as string | undefined,
  };
}
