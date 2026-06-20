import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ToolRegistry } from "../../common/interfaces/registry.js";
import type { JsonInputSchema } from "../../common/interfaces/types.js";
import { logger } from "../../common/services/logger.js";
import { loadMcpServerConfigs, type ResolvedMcpServer } from "./mcp-config.js";
import { McpTool, type McpCallToolResult, type McpToolInvoker } from "./mcp-tool.js";

const CLIENT_INFO = { name: "agentx", version: "0.1.0" };
const DEFAULT_TOOL_TIMEOUT_MS = 120_000;

interface ServerConnection {
  config: ResolvedMcpServer;
  client: Client;
}

/**
 * Connects AgentX (as an MCP client) to configured external MCP servers,
 * discovers their tools, and exposes them through the local {@link Tool}
 * abstraction. One persistent client is held per server.
 */
export class McpClientManager implements McpToolInvoker {
  private readonly connections = new Map<string, ServerConnection>();

  constructor(private readonly servers: ResolvedMcpServer[]) {}

  /** Builds a manager from the on-disk config file (or env-resolved default path). */
  static async fromConfig(configPath?: string): Promise<McpClientManager> {
    const servers = await loadMcpServerConfigs(configPath);
    return new McpClientManager(servers);
  }

  /** True when at least one server is configured (used to skip work entirely). */
  get hasServers(): boolean {
    return this.servers.length > 0;
  }

  /**
   * Connects to every configured server and registers their tools into the
   * shared registry. Failures are isolated per server so one bad server never
   * blocks startup. Returns the number of tools registered.
   */
  async registerInto(registry: ToolRegistry): Promise<number> {
    if (!this.hasServers) return 0;

    let registered = 0;
    for (const server of this.servers) {
      try {
        registered += await this.connectAndRegister(server, registry);
      } catch (e) {
        logger.error(`[mcp] Failed to connect MCP server "${server.name}"; skipping.`, {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    logger.info(`[mcp] Registered ${registered} tool(s) from ${this.connections.size} server(s).`);
    return registered;
  }

  private async connectAndRegister(
    server: ResolvedMcpServer,
    registry: ToolRegistry,
  ): Promise<number> {
    const client = new Client(CLIENT_INFO, { capabilities: {} });
    const transport =
      server.transport === "http"
        ? new StreamableHTTPClientTransport(new URL(server.url!), {
            requestInit: server.headers ? { headers: server.headers } : undefined,
          })
        : new StdioClientTransport({
            command: server.command!,
            args: server.args,
            env: server.env,
            cwd: server.cwd,
          });

    await client.connect(transport);
    this.connections.set(server.name, { config: server, client });

    const { tools } = await client.listTools();
    let count = 0;
    for (const remote of tools) {
      const registeredName = this.applyPrefix(server.namePrefix, remote.name);
      if (registry.get(registeredName)) {
        logger.warn(
          `[mcp] Tool name "${registeredName}" from server "${server.name}" collides with an existing tool; skipping.`,
        );
        continue;
      }
      const tool = new McpTool(
        server.name,
        remote.name,
        registeredName,
        remote.description ?? `MCP tool ${remote.name} from ${server.name}.`,
        remote.inputSchema as JsonInputSchema | undefined,
        this,
        server.toolTimeoutMs,
      );
      registry.register(tool);
      count += 1;
      logger.debug(`[mcp] Registered tool "${registeredName}" from server "${server.name}".`);
    }
    logger.info(`[mcp] Server "${server.name}" connected with ${count} tool(s).`);
    return count;
  }

  private applyPrefix(prefix: string, toolName: string): string {
    if (!prefix) return toolName;
    return `${prefix}.${toolName}`;
  }

  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
    options: { sessionId: string; runId?: string; signal?: AbortSignal; timeoutMs?: number },
  ): Promise<McpCallToolResult> {
    const conn = this.connections.get(serverName);
    if (!conn) {
      throw new Error(`MCP server "${serverName}" is not connected.`);
    }
    const result = await conn.client.callTool(
      {
        name: toolName,
        arguments: args,
        _meta: {
          "agentx/sessionId": options.sessionId,
          ...(options.runId ? { "agentx/runId": options.runId } : {}),
        },
      },
      undefined,
      {
        signal: options.signal,
        timeout: options.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS,
      },
    );
    return result as McpCallToolResult;
  }

  /** Closes all transports. Call on server shutdown. */
  async close(): Promise<void> {
    await Promise.all(
      [...this.connections.values()].map(async ({ config, client }) => {
        try {
          await client.close();
        } catch (e) {
          logger.warn(`[mcp] Error closing MCP server "${config.name}".`, {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }),
    );
    this.connections.clear();
  }
}
