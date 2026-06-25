import { logger } from "../../../../common/services/logger.js";
import type { Scored } from "../../../../managers/vector-manager.js";

export function formatCatalogLines(items: { name: string; description: string }[]): string {
  return items.map((item) => `- ${item.name}: ${item.description}`).join("\n");
}

export function normalizeNameList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

export function resolveNamesToScored<T extends { name: string }>(
  names: string[],
  byName: Map<string, T>,
  limit: number,
  contextLabel: string,
): Scored<T>[] {
  const sliced = names.slice(0, limit);
  const unknown = sliced.filter((name) => !byName.has(name));
  if (unknown.length > 0) {
    logger.debug(`LLM ${contextLabel} included unknown names`, { unknown });
  }

  return sliced
    .map((name) => byName.get(name))
    .filter((item): item is T => item !== undefined)
    .map((item) => ({ item, score: 1 }));
}
