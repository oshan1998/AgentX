/** Max chars for tool/skill observation text injected into prompts and session history. */
export const MAX_OBSERVATION_CHARS = 6_000;

/** Max chars for the recent-transcript section of the user prompt. */
export const TRANSCRIPT_CHAR_BUDGET = 12_000;

/** Max chars passed to long-term memory keyword search per iteration. */
export const MEMORY_QUERY_MAX_CHARS = 2_000;

/** Tool/error observations from PAST runs are collapsed to this many chars. */
export const PAST_OBSERVATION_MAX_CHARS = 400;

export interface MessageLike {
  role: string;
  content: string;
  meta?: {
    runId?: string;
    iteration?: number;
    kind?: string;
    toolName?: string;
    skillName?: string;
  };
}

/**
 * Renders one transcript line. When step metadata is present the line is
 * prefixed with its iteration + kind so the LLM reads the history as a
 * structured timeline. Observations from runs other than the current one are
 * collapsed hard — their full output is rarely needed once the run is over.
 */
function renderMessageLine(
  m: MessageLike,
  currentRunId: string | undefined,
): string {
  const meta = m.meta;
  let content = m.content;

  const isPastRun =
    !!meta?.runId && !!currentRunId && meta.runId !== currentRunId;
  if (isPastRun && (meta?.kind === "observation" || meta?.kind === "error")) {
    content = truncateForPrompt(content, PAST_OBSERVATION_MAX_CHARS);
  }

  if (meta?.iteration == null && !meta?.kind) {
    return `${m.role}: ${content}`;
  }

  const parts = [m.role];
  if (meta?.iteration != null) parts.unshift(`iter ${meta.iteration}`);
  if (meta?.kind) parts.push(meta.kind);
  const tail = meta?.toolName ?? meta?.skillName;
  const label = `[${parts.join(" · ")}${tail ? ` ${tail}` : ""}]`;
  return `${label} ${content}`;
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
    /** Run whose steps stay full-fidelity; defaults to the newest run in the pool. */
    currentRunId?: string;
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

  const currentRunId =
    options.currentRunId ??
    findLast(pool, (m) => !!m.meta?.runId)?.meta?.runId;

  const selected: string[] = [];
  let used = 0;
  let omitted = 0;

  for (let i = pool.length - 1; i >= 0; i--) {
    const line = renderMessageLine(pool[i], currentRunId);
    const lineLen = line.length + (selected.length > 0 ? 1 : 0);

    if (used + lineLen > charBudget && selected.length > 0) {
      omitted = i + 1;
      break;
    }

    selected.unshift(line);
    used += lineLen;
  }

  if (selected.length === 0) {
    const latest = renderMessageLine(pool[pool.length - 1], currentRunId);
    const content = truncateForPrompt(latest, Math.max(1, charBudget));
    omitted = pool.length - 1;
    return omitted > 0
      ? `[${omitted} older message(s) omitted]\n${content}`
      : content;
  }

  const header = omitted > 0 ? `[${omitted} older message(s) omitted]\n` : "";
  return header + selected.join("\n");
}

/** Array.prototype.findLast shim — reverse linear scan returning the match. */
function findLast<T>(arr: T[], pred: (v: T) => boolean): T | undefined {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i])) return arr[i];
  }
  return undefined;
}
