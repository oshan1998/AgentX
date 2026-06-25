import type { IntentResult, QueryComplexity, UserIntent } from "../types.js";

export interface IntentIdentificationParams {
  userInput: string;
}

export interface IntentIdentificationResult {
  intent: IntentResult;
  queryComplexity: QueryComplexity;
}

/**
 * Action verbs that strongly signal the query requires external tools or skills.
 * Kept intentionally broad — false positives (simple classified as complex) cost
 * one extra tool-injection token; false negatives (complex classified as simple)
 * cost extra agent iterations to discover missing tools.
 */
const ACTION_PATTERN =
  /\b(search|find|fetch|get|retrieve|look up|look up|create|make|generate|write|build|send|post|email|message|delete|remove|update|edit|modify|run|execute|analyze|summarize|translate|convert|calculate|compute|schedule|book|order|download|upload|read|open|save|deploy|install|check|monitor|list|show me|pull|push)\b/i;

const COMPLEXITY_SIGNALS = [
  /\b(step by step|multi.?step|plan|roadmap|pipeline|workflow|orchestrate|batch|parallel)\b/i,
  /\b(then|after that|next|finally|first.*then|and then)\b/i,
];

function classifyIntent(userInput: string): UserIntent {
  const trimmed = userInput.trim();

  // Long queries almost always involve doing something, not just recalling
  if (trimmed.split(/\s+/).length > 20) return "complex";

  if (ACTION_PATTERN.test(trimmed)) return "complex";

  if (COMPLEXITY_SIGNALS.some((re) => re.test(trimmed))) return "complex";

  return "simple";
}

/** Zero-cost heuristic classifier — no LLM call, no latency. */
export class IntentIdentificationService {
  identify(params: IntentIdentificationParams): IntentIdentificationResult {
    const label = classifyIntent(params.userInput);
    return {
      queryComplexity: label,
      intent: {
        label,
        signals: ["heuristic"],
      },
    };
  }
}
