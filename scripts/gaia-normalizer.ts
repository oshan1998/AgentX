/**
 * GAIA benchmark answer normalization.
 *
 * Ported from the official GAIA evaluation script:
 * https://huggingface.co/spaces/gaia-benchmark/leaderboard
 *
 * The normalizer is used on BOTH the expected answer and the agent's reply
 * before comparison, so formatting differences don't count as wrong answers.
 */

// ── Answer extraction ─────────────────────────────────────────────────────────

/**
 * Extracts the final answer from a verbose agent reply.
 * Looks for explicit markers first, then falls back to the last non-empty line.
 */
export function extractFinalAnswer(reply: string): string {
  if (!reply) return "";

  // Explicit marker inserted by our benchmark prompt suffix
  const markerMatch = reply.match(/FINAL ANSWER:\s*(.+)/i);
  if (markerMatch?.[1]) return markerMatch[1].trim();

  // Common agent phrasing
  const phrasePatterns = [
    /the (?:final )?answer is[:\s]+(.+)/i,
    /answer[:\s]+(.+)/i,
    /therefore[,\s]+(?:the answer is[:\s]+)?(.+)/i,
    /in (?:summary|conclusion)[,\s]+(?:the answer is[:\s]+)?(.+)/i,
  ];
  for (const pattern of phrasePatterns) {
    const lines = reply.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const m = lines[i].match(pattern);
      if (m?.[1]) return m[1].trim().replace(/\.$/, "");
    }
  }

  // Fall back to last non-empty line
  const lines = reply.split("\n").map(l => l.trim()).filter(Boolean);
  return lines[lines.length - 1] ?? "";
}

// ── Normalization ─────────────────────────────────────────────────────────────

/**
 * Normalizes a GAIA answer string for comparison.
 * Applied to both the expected answer and the extracted agent answer.
 */
export function normalizeGaiaAnswer(raw: string): string {
  if (!raw) return "";

  let s = extractFinalAnswer(raw);

  s = s.toLowerCase().trim();

  // Normalize number formatting: remove thousands separators
  s = s.replace(/(\d),(\d{3})/g, "$1$2");

  // Normalize decimal trailing zeros: 3.50 → 3.5, 3.0 → 3
  s = s.replace(/(\d+\.\d*[1-9])0+\b/g, "$1");
  s = s.replace(/(\d+)\.0+\b/g, "$1");

  // Remove units in parentheses e.g. "42 (km)" → "42"
  s = s.replace(/\s*\([^)]*\)/g, "");

  // Remove leading articles
  s = s.replace(/^(a|an|the)\s+/i, "");

  // Normalize punctuation — replace non-alphanumeric (except . and -) with spaces
  s = s.replace(/[^\w\s.\-]/g, " ");

  // Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();

  return s;
}

/**
 * Returns true if the agent answer matches the expected GAIA answer
 * after normalization of both sides.
 */
export function isGaiaAnswerCorrect(agentReply: string, expectedAnswer: string): boolean {
  const normalizedGot = normalizeGaiaAnswer(agentReply);
  const normalizedExpected = normalizeGaiaAnswer(expectedAnswer);
  return normalizedGot === normalizedExpected;
}
