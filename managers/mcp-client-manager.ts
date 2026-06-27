import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ToolRegistry } from "../common/interfaces/registry.js";
import type { JsonInputSchema } from "../common/interfaces/types.js";
import { logger } from "../common/services/logger.js";

export type McpServerConfig =
  | { name: string; type?: "stdio"; command: string; args?: string[]; env?: Record<string, string> }
  | { name: string; type: "http" | "sse"; url: string; headers?: Record<string, string> };

export class McpClientManager {
  private readonly clients: Client[] = [];

  async loadInto(registry: ToolRegistry, configs: McpServerConfig[]): Promise<void> {
    for (const config of configs) {
      try {
        const client = new Client({ name: "agentx", version: "1.0.0" }, { capabilities: {} });
        let isInternal = false;

        if ("command" in config) {
          isInternal = true;
          await client.connect(new StdioClientTransport({
            command: config.command,
            args: config.args ?? [],
            env: { ...(process.env as Record<string, string>), ...config.env },
          }));
        } else {
          await client.connect(new StreamableHTTPClientTransport(new URL(config.url), {
            requestInit: config.headers ? { headers: config.headers } : undefined,
          }));
        }

        this.clients.push(client);

        const { tools } = await client.listTools();
        for (const mcpTool of tools) {
          registry.register({
            name: mcpTool.name,
            description: mcpTool.description ?? "",
            inputSchema: mcpTool.inputSchema as JsonInputSchema,
            run: async (input, context) => {
              const args = isInternal
                ? { ...input, _sessionId: context.sessionId, ...(context.runId ? { _runId: context.runId } : {}) }
                : { ...input };
              const result = await client.callTool({ name: mcpTool.name, arguments: args });
              const content = result.content as Array<{ type: string; text?: string }>;
              const textContent = content.find((c) => c.type === "text");
              if (!textContent) return null;
              const text = textContent.text ?? "";
              if (result.isError) throw new Error(text);
              try {
                return JSON.parse(text);
              } catch {
                return text;
              }
            },
          });
        }

        logger.info(`[MCP] Connected to "${config.name}" (${tools.length} tools)`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`[MCP] Failed to connect to "${config.name}": ${message}`);
      }
    }
  }

  async shutdown(): Promise<void> {
    await Promise.all(this.clients.map((c) => c.close().catch(() => {})));
  }
}
