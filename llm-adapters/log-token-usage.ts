import { logger } from "../common/services/logger.js";

export interface LlmTokenUsageLog {
  provider: string;
  model: string;
  operation: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

export function logLlmTokenUsage(usage: LlmTokenUsageLog): void {
  logger.info("LLM token usage", usage);
}
