/** Max chars for tool/skill observation text injected into prompts and session history. */
export const MAX_OBSERVATION_CHARS = 6_000;

/** Max chars for the recent-transcript section of the user prompt. */
export const TRANSCRIPT_CHAR_BUDGET = 12_000;

/** Max chars passed to long-term memory keyword search per iteration. */
export const MEMORY_QUERY_MAX_CHARS = 2_000;

export interface MessageLike {
  role: string;
  content: string;
}

export function truncateForPrompt(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}… [truncated, ${text.length} chars total]`;
}

export function composeMemorySearchQuery(
  userInput: string,
  lastObservation: string | undefined,
  iteration: number,
): string {
  if (iteration === 1 || !lastObservation?.trim()) {
    return userInput.slice(0, MEMORY_QUERY_MAX_CHARS);
  }
  return `${userInput}\n${lastObservation}`.slice(0, MEMORY_QUERY_MAX_CHARS);
}

/**
 * Selects recent session messages newest-first within a char budget.
 * Omits the latest tool message when it duplicates `lastObservation`.
 */
export function selectMessagesForPrompt(
  messages: MessageLike[],
  options: {
    charBudget?: number;
    lastObservation?: string;
  } = {},
): string {
  const charBudget = options.charBudget ?? TRANSCRIPT_CHAR_BUDGET;
  const lastObservation = options.lastObservation;

  let pool = messages;
  if (lastObservation && pool.length > 0) {
    const last = pool[pool.length - 1];
    if (last.role === "tool" && last.content === lastObservation) {
      pool = pool.slice(0, -1);
    }
  }

  if (pool.length === 0) {
    return "none";
  }

  const selected: MessageLike[] = [];
  let used = 0;
  let omitted = 0;

  for (let i = pool.length - 1; i >= 0; i--) {
    const m = pool[i];
    const line = `${m.role}: ${m.content}`;
    const lineLen = line.length + (selected.length > 0 ? 1 : 0);

    if (used + lineLen > charBudget && selected.length > 0) {
      omitted = i + 1;
      break;
    }

    selected.unshift(m);
    used += lineLen;

    if (i > 0 && used >= charBudget) {
      omitted = i;
      break;
    }
  }

  if (selected.length === 0) {
    const latest = pool[pool.length - 1];
    const prefix = `${latest.role}: `;
    const content = truncateForPrompt(latest.content, Math.max(1, charBudget - prefix.length));
    omitted = pool.length - 1;
    const line = `${prefix}${content}`;
    return omitted > 0
      ? `[${omitted} older message(s) omitted]\n${line}`
      : line;
  }

  const lines = selected.map((m) => `${m.role}: ${m.content}`);
  const header = omitted > 0 ? `[${omitted} older message(s) omitted]\n` : "";
  return header + lines.join("\n");
}
