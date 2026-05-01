import fs from "node:fs/promises";
import path from "node:path";

export interface GmailCredentials {
  client_id: string;
  client_secret: string;
  refresh_token: string;
  access_token?: string;
  token_expiry?: number;
  connected_at: string;
  email?: string;
}

export interface IntegrationStatus {
  connected: boolean;
  email?: string;
  connected_at?: string;
}

/**
 * Manages integration secrets stored in a local `secrets/` directory.
 * Each integration gets its own subdirectory with a `credentials.json` file.
 */
export class SecretsManager {
  private readonly secretsDir: string;

  constructor(baseDir: string = process.cwd()) {
    this.secretsDir = path.join(baseDir, "secrets");
  }

  /** Ensure the secrets root and service subdirectory exist. */
  async init(): Promise<void> {
    await fs.mkdir(this.secretsDir, { recursive: true });
  }

  /** Get the directory for a given service (e.g. "gmail"). */
  private servicePath(service: string): string {
    return path.join(this.secretsDir, service);
  }

  /** Get the credentials file path for a service. */
  private credentialsPath(service: string): string {
    return path.join(this.servicePath(service), "credentials.json");
  }

  /** Save credentials for a given service. */
  async saveCredentials(
    service: string,
    credentials: Record<string, unknown>,
  ): Promise<void> {
    const dir = this.servicePath(service);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      this.credentialsPath(service),
      JSON.stringify(credentials, null, 2),
      "utf-8",
    );
  }

  /** Load credentials for a given service. Returns null if not found. */
  async loadCredentials<T = Record<string, unknown>>(
    service: string,
  ): Promise<T | null> {
    try {
      const raw = await fs.readFile(this.credentialsPath(service), "utf-8");
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  /** Check if credentials exist for a service. */
  async hasCredentials(service: string): Promise<boolean> {
    try {
      await fs.access(this.credentialsPath(service));
      return true;
    } catch {
      return false;
    }
  }

  /** Delete credentials for a service. */
  async deleteCredentials(service: string): Promise<void> {
    try {
      await fs.rm(this.servicePath(service), { recursive: true, force: true });
    } catch {
      // Already gone, no-op
    }
  }

  /** Get connection status for a service. */
  async getStatus(service: string): Promise<IntegrationStatus> {
    const creds = await this.loadCredentials<GmailCredentials>(service);
    if (!creds || !creds.refresh_token) {
      return { connected: false };
    }
    return {
      connected: true,
      email: creds.email,
      connected_at: creds.connected_at,
    };
  }
}
