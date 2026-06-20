import path from "node:path";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { logger } from "../../common/services/logger.js";

/**
 * Declarative configuration for an external MCP server AgentX connects to as a
 * client. Either `command` (stdio transport) or `url` (Streamable HTTP) is
 * required; the transport is inferred when not stated explicitly.
 */
export const mcpServerConfigSchema = z
  .object({
    transport: z.enum(["stdio", "http"]).optional(),
    disabled: z.boolean().optional(),
    /** Stdio: executable to spawn (e.g. "node", "npx", "docker"). */
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    cwd: z.string().optional(),
    /** HTTP: Streamable HTTP endpoint (e.g. "http://localhost:3101/mcp"). */
    url: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    /**
     * Prefix applied to every tool name from this server to avoid collisions
     * with local tools (e.g. "design" → "design.generate_image"). Defaults to
     * the server key. Set to "" to register tools under their bare names.
     */
    namePrefix: z.string().optional(),
    /** Per-call timeout in milliseconds for tools/call requests. */
    toolTimeoutMs: z.number().positive().optional(),
  })
  .describe("One MCP server connection definition.");

export type McpServerConfig = z.infer<typeof mcpServerConfigSchema>;

export const mcpConfigFileSchema = z
  .object({
    mcpServers: z.record(z.string(), mcpServerConfigSchema).default({}),
  })
  .describe("AgentX MCP client configuration file.");

export type McpConfigFile = z.infer<typeof mcpConfigFileSchema>;

/** A validated, env-resolved server config paired with its registry key. */
export interface ResolvedMcpServer {
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  namePrefix: string;
  toolTimeoutMs?: number;
}

const ENV_PLACEHOLDER = /\$\{([A-Z0-9_]+)\}/gi;

/** Replaces `${VAR}` placeholders with values from process.env (empty if unset). */
function interpolateEnv(value: string): string {
  return value.replace(ENV_PLACEHOLDER, (_match, name: string) => {
    const resolved = process.env[name];
    if (resolved === undefined) {
      logger.warn(`[mcp-config] Env var ${name} referenced but not set; using empty string.`);
      return "";
    }
    return resolved;
  });
}

function interpolateRecord(
  record: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!record) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(record)) {
    out[k] = interpolateEnv(v);
  }
  return out;
}

function resolveServer(name: string, raw: McpServerConfig): ResolvedMcpServer | undefined {
  if (raw.disabled) {
    logger.info(`[mcp-config] Server "${name}" is disabled; skipping.`);
    return undefined;
  }

  const transport: "stdio" | "http" =
    raw.transport ?? (raw.url ? "http" : raw.command ? "stdio" : "stdio");

  if (transport === "stdio" && !raw.command) {
    logger.warn(`[mcp-config] Server "${name}" uses stdio transport but has no command; skipping.`);
    return undefined;
  }
  if (transport === "http" && !raw.url) {
    logger.warn(`[mcp-config] Server "${name}" uses http transport but has no url; skipping.`);
    return undefined;
  }

  return {
    name,
    transport,
    command: raw.command,
    args: (raw.args ?? []).map(interpolateEnv),
    env: interpolateRecord(raw.env),
    cwd: raw.cwd ? interpolateEnv(raw.cwd) : undefined,
    url: raw.url ? interpolateEnv(raw.url) : undefined,
    headers: interpolateRecord(raw.headers),
    namePrefix: raw.namePrefix ?? name,
    toolTimeoutMs: raw.toolTimeoutMs,
  };
}

/**
 * Loads and validates the MCP client config. Missing file is treated as "no
 * servers configured" so AgentX runs unchanged when MCP is not in use.
 */
export async function loadMcpServerConfigs(
  configPath: string = path.join(process.cwd(), "config", "mcp-servers.json"),
): Promise<ResolvedMcpServer[]> {
  let rawText: string;
  try {
    rawText = await readFile(configPath, "utf-8");
  } catch {
    logger.info(`[mcp-config] No MCP config at ${configPath}; no external servers loaded.`);
    return [];
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch (e) {
    logger.error(`[mcp-config] Failed to parse ${configPath} as JSON; ignoring.`, {
      error: e instanceof Error ? e.message : String(e),
    });
    return [];
  }

  const validated = mcpConfigFileSchema.safeParse(parsedJson);
  if (!validated.success) {
    logger.error(`[mcp-config] Invalid MCP config; ignoring.`, {
      error: validated.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    });
    return [];
  }

  const resolved: ResolvedMcpServer[] = [];
  for (const [name, raw] of Object.entries(validated.data.mcpServers)) {
    const server = resolveServer(name, raw);
    if (server) resolved.push(server);
  }
  return resolved;
}
