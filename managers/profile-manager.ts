import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export interface Soul {
  name: string;
  personality: {
    tone: string;
    quirks: string;
  };
  useEmojies:boolean;
}

export interface User {
  name: string;
  role: string;
  facts: string[];
}

export class ProfileManager {
  constructor(private readonly basePath: string) {}

  async init(): Promise<void> {
    await mkdir(this.basePath, { recursive: true });
    
    try {
      await readFile(this.getSoulPath(), "utf-8");
    } catch {
      await writeFile(
        this.getSoulPath(),
        JSON.stringify({
          name: "AgentX",
          personality: { tone: "", quirks: "" },
          useEmojies:false
        }, null, 2),
        "utf-8"
      );
    }

    try {
      await readFile(this.getUserPath(), "utf-8");
    } catch {
      await writeFile(
        this.getUserPath(),
        JSON.stringify({
          name: "",
          role: "",
          facts: []
        }, null, 2),
        "utf-8"
      );
    }
  }

  async getSoul(): Promise<Soul> {
    const raw = await readFile(this.getSoulPath(), "utf-8");
    return JSON.parse(raw) as Soul;
  }

  async getUser(): Promise<User> {
    const raw = await readFile(this.getUserPath(), "utf-8");
    return JSON.parse(raw) as User;
  }

  async setSoul(data: Record<string, unknown>): Promise<Soul> {
    await writeFile(this.getSoulPath(), JSON.stringify(data, null, 2), "utf-8");
    return data as unknown as Soul;
  }

  async setUser(data: Record<string, unknown>): Promise<User> {
    await writeFile(this.getUserPath(), JSON.stringify(data, null, 2), "utf-8");
    return data as unknown as User;
  }

  private getSoulPath(): string {
    return path.join(this.basePath, "soul.json");
  }

  private getUserPath(): string {
    return path.join(this.basePath, "user.json");
  }
}
