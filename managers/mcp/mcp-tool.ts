import type { JsonInputSchema, Tool, ToolContext } from "../../common/interfaces/types.js";

/** Subset of the MCP CallTool result this adapter understands. */
export interface McpCallToolResult {
  content?: Array<Record<string, unknown>>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  toolResult?: unknown;
}

/** Anything able to invoke a tool on a named MCP server. */
export interface McpToolInvoker {
  callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
    options: { sessionId: string; runId?: string; signal?: AbortSignal; timeoutMs?: number },
  ): Promise<McpCallToolResult>;
}

/**
 * Converts an MCP CallTool result into the plain value the agent loop expects as
 * a tool observation. Mirrors local tools, which return strings or JSON-able
 * objects directly.
 *
 * - `isError` results are thrown so `Executor` formats them as error
 *   observations, consistent with how local tools surface failures.
 * - `structuredContent` is returned as-is when present.
 * - Otherwise text parts are concatenated; non-text parts (images, resources)
 *   are summarized so the model still sees that something was produced.
 */
export function normalizeMcpResult(toolName: string, result: McpCallToolResult): unknown {
  if (result.toolResult !== undefined && result.content === undefined) {
    if (result.isError) {
      throw new Error(`MCP tool ${toolName} failed: ${stringifyUnknown(result.toolResult)}`);
    }
    return result.toolResult;
  }

  const parts = result.content ?? [];
  const textParts: string[] = [];
  const otherParts: string[] = [];

  for (const part of parts) {
    if (part.type === "text" && typeof part.text === "string") {
      textParts.push(part.text);
    } else if (part.type === "image" || part.type === "audio") {
      const mime = typeof part.mimeType === "string" ? part.mimeType : "binary";
      otherParts.push(`[${String(part.type)}:${mime}]`);
    } else if (part.type === "resource" || part.type === "resource_link") {
      const uri =
        typeof part.uri === "string"
          ? part.uri
          : typeof (part.resource as { uri?: unknown })?.uri === "string"
            ? (part.resource as { uri: string }).uri
            : "unknown";
      otherParts.push(`[resource:${uri}]`);
    } else if (part.type) {
      otherParts.push(`[${String(part.type)}]`);
    }
  }

  if (result.isError) {
    const message = [...textParts, ...otherParts].join("\n").trim();
    throw new Error(`MCP tool ${toolName} failed: ${message || "unknown error"}`);
  }

  if (result.structuredContent !== undefined) {
    return result.structuredContent;
  }

  const combined = [...textParts, ...otherParts].join("\n").trim();
  return combined.length > 0 ? combined : "";
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Bridges a single remote MCP tool into the local {@link Tool} interface so the
 * agent loop, executor, skills, sub-agents, and orchestrator treat it
 * identically to an in-process tool.
 */
export class McpTool implements Tool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: JsonInputSchema;

  constructor(
    /** Server registry key this tool belongs to. */
    private readonly serverName: string,
    /** Bare tool name as exposed by the MCP server. */
    private readonly remoteName: string,
    /** Public, possibly prefixed name registered in the ToolRegistry. */
    registeredName: string,
    description: string,
    inputSchema: JsonInputSchema | undefined,
    private readonly invoker: McpToolInvoker,
    private readonly toolTimeoutMs?: number,
  ) {
    this.name = registeredName;
    this.description = description;
    this.inputSchema = inputSchema;
  }

  async run(input: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const result = await this.invoker.callTool(this.serverName, this.remoteName, input, {
      sessionId: context.sessionId,
      runId: context.runId,
      signal: context.abortSignal,
      timeoutMs: this.toolTimeoutMs,
    });
    return normalizeMcpResult(this.name, result);
  }
}
