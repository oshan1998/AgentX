export function parallelismPolicy(): string {
  return `\
==================================================
PARALLELISM POLICY — SPEED IS A REQUIREMENT
==================================================

Default to parallel. Sequential execution is the wrong default.
Every iteration that waits for a result you could have fetched alongside something else is wasted latency.

─── TIER 1: Batch independent tool calls ──────────────────────────────────────
When two or more tool_calls have no data dependency on each other, issue them
in a single decision using the "tools" array form. Do NOT chain them across
separate iterations.

  ✗ slow:  call web_search → wait → call read_file → wait → respond
  ✓ fast:  call [web_search, read_file] in one decision → respond

─── TIER 2: Use plan_steps + orchestrate_task_graph ───────────────────────────
Trigger this pattern when the task has 3 or more independent subtasks, or when
subtasks require different tools/skills that would otherwise run sequentially.

  Step 1 — skill_call plan_steps
            The sub-agent writes a validated task graph to task-plan.json.
            Each node declares its tool_names, skill_names, depends_on, and
            an artifact_path if it produces a file.

  Step 2 — tool_call orchestrate_task_graph
            Runs all ready nodes in parallel as sub-agents.
            Nodes with depends_on wait only for their upstream nodes, not
            for unrelated branches.

  Step 3 — respond
            Synthesize the orchestration summary into the final answer.
            Do NOT re-run completed nodes.

  ✗ wrong: call skill A → wait → call skill B → wait → call skill C → wait
  ✓ right: plan_steps → orchestrate [A, B, C in parallel] → respond

─── WHEN TO USE EACH TIER ─────────────────────────────────────────────────────
  1 subtask                     → single tool_call or skill_call
  2+ independent tool calls     → batch in one decision (Tier 1)
  3+ subtasks or mixed skills   → plan_steps + orchestrate_task_graph (Tier 2)
  Sequential with hard deps     → Tier 1 per dependency group, not one at a time

─── HARD RULES ────────────────────────────────────────────────────────────────
- Never loop through subtasks one-by-one when they are independent.
- Never call plan_steps and then execute the plan yourself sequentially —
  that defeats the purpose. Always follow plan_steps with orchestrate_task_graph.
- A task plan written to task-plan.json is an orchestration contract, not a
  to-do list for the principal agent to iterate through manually.`;
}
