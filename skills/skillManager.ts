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
    // Load global skills
    const globalSkills = await loadConfigSkills(
      path.join(this.baseDir, "skills"),
      this.llm,
    );
    for (const skill of globalSkills) {
      this.skillRegistry.register(skill);
    }

    // Load connector skills (search connectors/*/skills)
    const connectorsDir = path.join(this.baseDir, "connectors");
    let connectorEntries: string[] = [];
    try {
      const { readdir } = await import("node:fs/promises");
      connectorEntries = await readdir(connectorsDir);
    } catch {
      // No connectors directory
    }
    for (const connector of connectorEntries) {
      const skillsPath = path.join(connectorsDir, connector, "skills");
      const skills = await loadConfigSkills(skillsPath, this.llm);
      for (const skill of skills) {
        this.skillRegistry.register(skill);
      }
    }
    return this.skillRegistry;
  }
}
