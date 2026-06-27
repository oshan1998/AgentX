import path from "node:path";
import { SkillRegistry } from "../common/interfaces/registry.js";
import { loadSkillsFromDirectory } from "../core/skills/index.js";
import type { LlmAdapter } from "../common/interfaces/types.js";

export class SkillManager {
  private readonly skillRegistry = new SkillRegistry();

  constructor(
    private readonly llm: LlmAdapter,
    private readonly baseDir: string = process.cwd(),
  ) {}

  async loadAllSkills(): Promise<SkillRegistry> {
    const skillsDir = path.join(this.baseDir, "skills");
    const skills = await loadSkillsFromDirectory(skillsDir, this.llm);
    for (const skill of skills) {
      this.skillRegistry.register(skill);
    }
    return this.skillRegistry;
  }
}
