import type { ToolRegistry } from "../../common/interfaces/registry.js";
import type { Tool } from "../../common/interfaces/types.js";
import { logger } from "../../common/services/logger.js";

export interface McpServerCatalogEntry {
  name: string;
  description: string;
  toolCount: number;
  toolNames: string[];
}

/** Keyword hints per known MCP server key (config name). */
const SERVER_HINTS: Record<string, string[]> = {
  web: ["search", "web", "internet", "google", "browse", "stock image", "unsplash", "tavily"],
  gmail: ["email", "gmail", "inbox", "mail", "message from"],
  design: [
    "image",
    "pdf",
    "svg",
    "logo",
    "infographic",
    "graphic",
    "design",
    "overlay",
    "png",
    "render",
  ],
  github: ["github", "repository", "repo", "pull request", "commit", "branch", "gist"],
  jira: ["jira", "ticket", "sprint", "atlassian", "issue tracker", "epic"],
  figma: ["figma", "prototype", "design file", "frame"],
  filesystem: ["file system", "filesystem", "directory", "folder"],
};

function synthesizeDescription(serverName: string, tools: Tool[]): string {
  const hints = SERVER_HINTS[serverName];
  if (hints?.length) {
    return `${serverName}: ${hints.slice(0, 6).join(", ")}`;
  }
  const samples = tools
    .slice(0, 4)
    .map((t) => t.description?.split(/[.!]/)[0]?.trim() || t.name)
    .filter(Boolean)
    .join("; ");
  return samples ? `${serverName}: ${samples}` : serverName;
}

/** Groups registered MCP tools by {@link Tool.mcpServer}. */
export function buildMcpServerCatalog(toolRegistry: ToolRegistry): McpServerCatalogEntry[] {
  const byServer = new Map<string, Tool[]>();
  for (const tool of toolRegistry.list()) {
    if (!tool.mcpServer) continue;
    const list = byServer.get(tool.mcpServer) ?? [];
    list.push(tool);
    byServer.set(tool.mcpServer, list);
  }

  return [...byServer.entries()]
    .map(([name, tools]) => ({
      name,
      description: synthesizeDescription(name, tools),
      toolCount: tools.length,
      toolNames: tools.map((t) => t.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function scoreServer(messageLower: string, server: McpServerCatalogEntry): number {
  let score = 0;
  const name = server.name.toLowerCase();

  if (messageLower.includes(name)) {
    score += 12;
  }

  for (const hint of SERVER_HINTS[server.name] ?? []) {
    if (messageLower.includes(hint.toLowerCase())) {
      score += 4;
    }
  }

  for (const toolName of server.toolNames) {
    const bare = toolName.includes(".") ? toolName.split(".").pop()! : toolName;
    const normalized = bare.replace(/_/g, " ").toLowerCase();
    if (normalized.length >= 4 && messageLower.includes(normalized)) {
      score += 3;
    }
  }

  const descWords = server.description
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 5);
  for (const word of descWords) {
    if (messageLower.includes(word)) {
      score += 1;
    }
  }

  return score;
}

/**
 * Picks zero or more MCP servers whose tools should have input schemas inlined
 * for this user message. Returns [] when no server is a confident match.
 */
export function routeMcpServers(
  userMessage: string,
  catalog: McpServerCatalogEntry[],
): string[] {
  if (!userMessage.trim() || catalog.length === 0) {
    return [];
  }

  const messageLower = userMessage.toLowerCase();
  const scored = catalog
    .map((server) => ({ server: server.name, score: scoreServer(messageLower, server) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return [];
  }

  const topScore = scored[0].score;
  const threshold = Math.max(4, topScore * 0.45);
  const selected = scored.filter((s) => s.score >= threshold).map((s) => s.server);

  logger.info("[mcp-router] Selected MCP servers for schema injection", {
    selected,
    scores: scored.slice(0, 5),
  });

  return selected;
}
