/**
 * GAIA Benchmark Harness for AgentX
 *
 * Usage:
 *   npm run bench:gaia                     # Level 1, first 20 questions
 *   GAIA_LEVEL=2 npm run bench:gaia        # Level 2
 *   GAIA_MAX=50 npm run bench:gaia         # First 50 questions
 *   GAIA_TASK_ID=abc-123 npm run bench:gaia  # Single question by task_id
 *
 * Prerequisites:
 *   Run `python3 scripts/download-gaia.py` first to populate
 *   scripts/data/gaia_validation.json
 */

import "dotenv/config";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";

import {
  AgentLoop,
  AgentType,
  AgentRuntimeFactory,
  registerDelegateToolOnce,
} from "../core/index.js";
import { createLlmAdapter } from "../llm-adapters/factory.js";
import { MemoryManager } from "../managers/memory-manager.js";
import { ProfileManager } from "../managers/profile-manager.js";
import { SkillManager } from "../managers/skill-manager.js";
import { ToolManager } from "../managers/tool-manager.js";
import { ListCapabilitiesTool } from "../core-tools/list-capabilities.js";
import { isGaiaAnswerCorrect, normalizeGaiaAnswer } from "./gaia-normalizer.js";

// ── Types ─────────────────────────────────────────────────────────────────────

interface GaiaQuestion {
  task_id: string;
  Question: string;
  Level: number | string;   // HuggingFace serialises this as a string
  "Final answer": string;
  file_name?: string;
  file_path?: string;
  "Annotator Metadata"?: {
    Steps?: string;
    "Number of steps"?: string | number;
    "How long did this take?"?: string;
    Tools?: string;
    "Number of tools"?: string | number;
  };
}

interface QuestionResult {
  task_id: string;
  level: number;
  question: string;
  expected: string;
  expected_normalized: string;
  got: string;
  got_normalized: string;
  correct: boolean;
  duration_ms: number;
  error?: string;
}

interface BenchmarkSummary {
  run_at: string;
  level: number;
  total: number;
  correct: number;
  accuracy_pct: number;
  avg_duration_ms: number;
  results: QuestionResult[];
}

// ── Config ────────────────────────────────────────────────────────────────────

const LEVEL_FILTER = parseInt(process.env.GAIA_LEVEL ?? "1");
const MAX_QUESTIONS = parseInt(process.env.GAIA_MAX ?? "20");
const TASK_ID_FILTER = process.env.GAIA_TASK_ID ?? null;
const AGENT_MAX_ITERATIONS = parseInt(process.env.GAIA_AGENT_ITERS ?? "20");

const DATA_DIR = path.join(process.cwd(), "scripts/data");
const DATASET_PATH = path.join(DATA_DIR, "gaia_validation.json");
const RESULTS_PATH = path.join(DATA_DIR, `results_L${LEVEL_FILTER}_${Date.now()}.json`);
const LATEST_RESULTS_PATH = path.join(DATA_DIR, "results_latest.json");

/**
 * Appended to every GAIA question so the agent always closes with a
 * machine-readable marker that the normalizer can extract reliably.
 */
const ANSWER_SUFFIX = `

IMPORTANT: At the very end of your response, on its own line, write exactly:
FINAL ANSWER: <your answer here>
The answer should be as concise as possible — a number, name, date, or short phrase. No explanation after the marker.`;

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function bootstrap() {
  // Isolated memory dir so benchmark runs don't pollute production memory
  const memoryPath = path.join(process.cwd(), "memory-bench");
  const memoryManager = new MemoryManager(memoryPath);
  await memoryManager.init();

  const profileManager = new ProfileManager(memoryPath);
  await profileManager.init();

  const llm = createLlmAdapter();

  const toolManager = new ToolManager(memoryManager);
  const toolRegistry = await toolManager.loadAllTools();

  const skillManager = new SkillManager(llm);
  const skillRegistry = await skillManager.loadAllSkills();

  const agentRuntimeFactory = new AgentRuntimeFactory({
    llm,
    memoryManager,
    profileManager,
    masterToolRegistry: toolRegistry,
    masterSkillRegistry: skillRegistry,
  });

  registerDelegateToolOnce(toolRegistry, agentRuntimeFactory.delegateTool);
  registerDelegateToolOnce(toolRegistry, agentRuntimeFactory.orchestrateTool);
  registerDelegateToolOnce(
    toolRegistry,
    new ListCapabilitiesTool(toolRegistry, skillRegistry),
  );

  const agentLoop = new AgentLoop({
    llm,
    memoryManager,
    profileManager,
    toolRegistry,
    skillRegistry,
    agentType: AgentType.Primary,
    skillDelegateRunner: agentRuntimeFactory.skillDelegateRunner,
    maxIterations: AGENT_MAX_ITERATIONS,
  });

  return agentLoop;
}

// ── Question runner ───────────────────────────────────────────────────────────

async function runQuestion(
  agentLoop: AgentLoop,
  q: GaiaQuestion,
  index: number,
  total: number,
): Promise<QuestionResult> {
  const sessionId = randomUUID();
  const prompt = q.Question + ANSWER_SUFFIX;
  const expected = q["Final answer"];

  console.log(`\n[${index}/${total}] task_id: ${q.task_id}  (Level ${q.Level})`);
  console.log(`  Q: ${q.Question.slice(0, 120)}${q.Question.length > 120 ? "…" : ""}`);

  const start = Date.now();
  let got = "";
  let error: string | undefined;

  try {
    got = await agentLoop.handleUserInput(sessionId, prompt);
  } catch (e: unknown) {
    error = e instanceof Error ? e.message : String(e);
    console.log(`  ERROR: ${error}`);
  }

  const duration_ms = Date.now() - start;
  const correct = isGaiaAnswerCorrect(got, expected);

  console.log(`  Expected : "${normalizeGaiaAnswer(expected)}"`);
  console.log(`  Got      : "${normalizeGaiaAnswer(got)}"`);
  console.log(`  Result   : ${correct ? "CORRECT ✓" : "WRONG ✗"}  (${(duration_ms / 1000).toFixed(1)}s)`);

  return {
    task_id: q.task_id,
    level: Number(q.Level),
    question: q.Question,
    expected,
    expected_normalized: normalizeGaiaAnswer(expected),
    got,
    got_normalized: normalizeGaiaAnswer(got),
    correct,
    duration_ms,
    error,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  AgentX × GAIA Benchmark");
  console.log(`  Level: ${LEVEL_FILTER}  |  Max questions: ${TASK_ID_FILTER ? "1 (by task_id)" : MAX_QUESTIONS}`);
  console.log(`  Agent max iterations: ${AGENT_MAX_ITERATIONS}`);
  console.log("═══════════════════════════════════════════════════════\n");

  // Load dataset
  let raw: string;
  try {
    raw = await readFile(DATASET_PATH, "utf-8");
  } catch {
    console.error(`ERROR: Dataset not found at ${DATASET_PATH}`);
    console.error("Run first: python3 scripts/download-gaia.py");
    process.exit(1);
  }

  const allQuestions: GaiaQuestion[] = JSON.parse(raw);

  // Filter + slice
  let subset = TASK_ID_FILTER
    ? allQuestions.filter(q => q.task_id === TASK_ID_FILTER)
    : allQuestions.filter(q => Number(q.Level) === LEVEL_FILTER).slice(0, MAX_QUESTIONS);

  if (subset.length === 0) {
    console.error(
      TASK_ID_FILTER
        ? `ERROR: task_id "${TASK_ID_FILTER}" not found in dataset.`
        : `ERROR: No Level ${LEVEL_FILTER} questions found in dataset.`,
    );
    process.exit(1);
  }

  console.log(`Loaded ${allQuestions.length} total questions. Running ${subset.length}.\n`);

  // Bootstrap agent (once, reused across all questions)
  console.log("Bootstrapping AgentX...");
  const agentLoop = await bootstrap();
  console.log("Agent ready.\n");

  const results: QuestionResult[] = [];
  let correct = 0;

  for (let i = 0; i < subset.length; i++) {
    const result = await runQuestion(agentLoop, subset[i], i + 1, subset.length);
    results.push(result);
    if (result.correct) correct++;

    // Save incremental results after each question so progress is never lost
    await saveResults(results, correct, subset.length);
  }

  printSummary(results, correct, subset.length);
}

// ── Persistence ───────────────────────────────────────────────────────────────

async function saveResults(
  results: QuestionResult[],
  correct: number,
  total: number,
): Promise<void> {
  const summary: BenchmarkSummary = {
    run_at: new Date().toISOString(),
    level: LEVEL_FILTER,
    total,
    correct,
    accuracy_pct: total > 0 ? parseFloat(((correct / results.length) * 100).toFixed(1)) : 0,
    avg_duration_ms:
      results.length > 0
        ? Math.round(results.reduce((s, r) => s + r.duration_ms, 0) / results.length)
        : 0,
    results,
  };

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(RESULTS_PATH, JSON.stringify(summary, null, 2));
  await writeFile(LATEST_RESULTS_PATH, JSON.stringify(summary, null, 2));
}

function printSummary(results: QuestionResult[], correct: number, total: number): void {
  const pct = total > 0 ? ((correct / total) * 100).toFixed(1) : "0.0";
  const avgMs = results.length > 0
    ? Math.round(results.reduce((s, r) => s + r.duration_ms, 0) / results.length)
    : 0;

  const wrong = results.filter(r => !r.correct && !r.error);
  const errored = results.filter(r => !!r.error);

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  BENCHMARK COMPLETE");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Level        : ${LEVEL_FILTER}`);
  console.log(`  Accuracy     : ${correct}/${total}  (${pct}%)`);
  console.log(`  Correct      : ${correct}`);
  console.log(`  Wrong        : ${wrong.length}`);
  console.log(`  Errors       : ${errored.length}`);
  console.log(`  Avg time/q   : ${(avgMs / 1000).toFixed(1)}s`);
  console.log(`  Results saved: ${LATEST_RESULTS_PATH}`);
  console.log("═══════════════════════════════════════════════════════\n");

  if (wrong.length > 0) {
    console.log("Wrong answers:");
    for (const r of wrong) {
      console.log(`  [${r.task_id}] expected "${r.expected_normalized}" | got "${r.got_normalized}"`);
    }
    console.log();
  }
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
