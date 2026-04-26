import path from "node:path";
import { SkillRegistry } from "../interfaces/registry.js";
import { loadConfigSkills } from "../core/config-skill-runner.js";
import type { LlmAdapter } from "../interfaces/types.js";

export class SkillManager {
  private readonly skillRegistry = new SkillRegistry();

  constructor(
    private readonly llm: LlmAdapter,
    private readonly baseDir: string = process.cwd(),
  ) {}

  async loadAllSkills(): Promise<SkillRegistry> {
    const roots = ["capabilities", "integrations"];
    const { readdir } = await import("node:fs/promises");

    for (const root of roots) {
      const rootDir = path.join(this.baseDir, root);
      let entries: string[] = [];
      try {
        entries = await readdir(rootDir);
      } catch {
        continue;
      }

      for (const entry of entries) {
        const skillsPath = path.join(rootDir, entry, "skills");
        const skills = await loadConfigSkills(skillsPath, this.llm);
        for (const skill of skills) {
          this.skillRegistry.register(skill);
        }
      }
    }
    return this.skillRegistry;
  }
}
