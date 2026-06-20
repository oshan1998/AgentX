import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Tool, ToolContext } from "../../common/interfaces/types.js";
import { logger } from "../_shared/logger.js";

export interface ServeToolsOptions {
  name: string;
  version: string;
  tools: Tool[];
}

const SESSION_META_KEY = "agentx/sessionId";
const RUN_META_KEY = "agentx/runId";
const FALLBACK_SESSION_ID = "mcp-default-session";

/** Reads the AgentX-bridged session id from request `_meta`, with a fallback. */
function resolveSessionId(meta: Record<string, unknown> | undefined): string {
  const value = meta?.[SESSION_META_KEY];
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  logger.warn(
    `[mcp-harness] Missing ${SESSION_META_KEY} in call _meta; using fallback session.`,
  );
  return FALLBACK_SESSION_ID;
}

function resolveRunId(meta: Record<string, unknown> | undefined): string | undefined {
  const value = meta?.[RUN_META_KEY];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Serializes a local tool's return value into MCP tool result content. */
function toToolResult(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return { content: [{ type: "text" as const, text: text ?? "" }] };
}

/**
 * Serves a set of local {@link Tool} instances over the MCP stdio transport,
 * reusing their existing `run()` logic verbatim. Session context is bridged
 * from request `_meta` into {@link ToolContext}.
 */
export async function serveToolsOverStdio(options: ServeToolsOptions): Promise<void> {
  const toolsByName = new Map<string, Tool>();
  for (const tool of options.tools) {
    toolsByName.set(tool.name, tool);
  }

  const server = new Server(
    { name: options.name, version: options.version },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...toolsByName.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: (tool.inputSchema as { type: "object" } | undefined) ?? {
        type: "object" as const,
        properties: {},
      },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const toolName = request.params.name;
    const tool = toolsByName.get(toolName);
    if (!tool) {
      return {
        content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
        isError: true,
      };
    }

    const meta = request.params._meta as Record<string, unknown> | undefined;
    const context: ToolContext = {
      sessionId: resolveSessionId(meta),
      runId: resolveRunId(meta),
      abortSignal: extra?.signal,
    };

    try {
      const result = await tool.run(request.params.arguments ?? {}, context);
      return toToolResult(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logger.error(`[mcp-harness] Tool "${toolName}" failed: ${message}`);
      return { content: [{ type: "text", text: message }], isError: true };
    }
  });

  await server.connect(new StdioServerTransport());
  logger.info(
    `[mcp-harness] ${options.name} v${options.version} serving ${toolsByName.size} tool(s) over stdio.`,
  );
}
