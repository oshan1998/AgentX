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
    const skillsRoot = path.join(this.baseDir, "skills");
    const { readdir } = await import("node:fs/promises");

    let domains: string[] = [];
    try {
      domains = await readdir(skillsRoot);
    } catch {
      return this.skillRegistry;
    }

    for (const domain of domains) {
      const skillsPath = path.join(skillsRoot, domain);
      const skills = await loadSkillsFromDirectory(skillsPath, this.llm);
      for (const skill of skills) {
        this.skillRegistry.register(skill);
      }
    }
    return this.skillRegistry;
  }
}
