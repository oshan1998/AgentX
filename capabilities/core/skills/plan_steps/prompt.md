# plan_steps — Task Planner

You receive a skill input JSON with an `objective` field. Your job is to break it into a concrete task plan and write it to the task store.

---

## Step 1 — Read before writing

Call `read_task_plan({})` first. If a plan exists, decide whether to extend or replace it based on the objective.

---

## Step 2 — Define tasks

Create **4–8 tasks** (fewer if the goal is simple). Each task must have:

| Field | Required | Description |
|---|---|---|
| `id` | ✅ | `snake_case`, stable, unique. E.g. `market_overview` |
| `title` | ✅ | Short label, 3–6 words |
| `status` | ✅ | `pending` for most; `in_progress` only for the first task if starting now |
| `instruction` | ✅ | **Specific, executable steps** — what the worker must do, nothing left ambiguous |
| `artifact_path` | ✅ | Where output is saved. Use `tasks/<id>.<ext>`. Pick the right extension: `.md`, `.json`, `.csv`, `.pdf`, `.png` |
| `depends_on` | ✅ | Array of `id`s that must complete first. Use `[]` if none |
| `tool_names` | ✅ | Tools the worker may use. See rules below |
| `notes` | optional | 1–2 sentences on constraints or expected output shape |

---

## Step 3 — Tool selection (critical — task failure cause #1)

**For every task, mentally simulate the worker executing it step by step. Every action the worker takes needs a tool. If the tool is missing, the task will fail.**

### Simulation method

Read the `instruction` and ask: what does the worker need to *do* at each step?

> Example instruction: "Search for top EV manufacturers, read the competitor list from tasks/competitors.json, build a comparison table, and save as markdown."
>
> Simulated steps:
> 1. Search the web → needs `web_search`
> 2. Read upstream file → needs `read_file`
> 3. Save output → needs `write_file`
>
> → `tool_names: ["web_search", "read_file", "write_file"]`


### Hard checks — do all of these before writing the plan

- [ ] Every task with an `artifact_path` has `write_file` in `tool_names`
- [ ] Every task with a non-empty `depends_on` has `read_file` in `tool_names`
- [ ] No task has an empty `tool_names: []` unless it genuinely does zero I/O (rare)
- [ ] No task is missing a tool just because the step "seems simple"

### Never include

`delegate_sub_agent`, `orchestrate_task_graph`, `read_task_plan`, `write_task_plan`, `patch_task_plan_task`

### When in doubt — include the tool

A tool that isn't needed wastes nothing. A tool that is needed but missing causes the task to fail. **Always err on the side of inclusion.**

---

## Step 4 — Parallelism rules

Tasks with no shared dependencies can run at the same time.

- **Independent research tasks** (different topics) → `depends_on: []` on both
- **Tasks that need another task's output** → list that task's `id` in `depends_on`
- **Final report/summary** → `depends_on` every content-producing task

---

## Step 5 — Write the plan

Call `write_task_plan({ "tasks": [...] })` with the full list. This replaces the existing plan.

Use `patch_task_plan_task` only for single-field updates (status, notes, blocked_reason) without rewriting everything.

---

## Step 6 — Reply to the principal

List the tasks by number with their titles and a one-sentence summary. Mention:
- Which tasks can run in parallel
- That outputs are written to `artifact_path` files — not kept in memory
- That later tasks should use `read_task_plan` + `read_file` to access prior results

---

## Example

**Objective:** "Research the EV market and write a competitive analysis report."

```json
[
  {
    "id": "market_overview",
    "title": "EV market size and trends",
    "status": "pending",
    "instruction": "Search for current EV market size, growth rate (2023–2025), top regions, and key adoption drivers. Write a structured summary covering: (1) global market size in USD, (2) YoY growth %, (3) top 3 regions by adoption, (4) top 3 demand drivers. Save as markdown.",
    "artifact_path": "tasks/market_overview.md",
    "depends_on": [],
    "tool_names": ["web_search", "web_fetch", "write_file"]
  },
  {
    "id": "competitor_profiles",
    "title": "Top EV manufacturer profiles",
    "status": "pending",
    "instruction": "Search for the top 5 EV manufacturers by 2024 sales volume. For each: name, HQ country, best-selling model, estimated market share %, and one strategic differentiator. Save as a JSON array.",
    "artifact_path": "tasks/competitor_profiles.json",
    "depends_on": [],
    "tool_names": ["web_search", "web_fetch", "write_file"]
  },
  {
    "id": "competitive_analysis",
    "title": "Write competitive analysis report",
    "status": "pending",
    "instruction": "Read tasks/market_overview.md and tasks/competitor_profiles.json. Synthesize into a competitive analysis report with sections: Executive Summary, Market Landscape, Competitor Comparison Table, Key Takeaways. Save as markdown.",
    "artifact_path": "tasks/competitive_analysis.md",
    "depends_on": ["market_overview", "competitor_profiles"],
    "tool_names": ["read_file", "write_file"]
  }
]
```

In this example, `market_overview` and `competitor_profiles` have no dependencies — they run **in parallel**. `competitive_analysis` waits for both.

---

## Rules

- Do not change or expand the objective — plan only what was asked
- `instruction` must be specific enough that a worker can execute it without asking clarifying questions
- `artifact_path` is the only handoff between tasks — workers must not rely on conversation memory
- Status values: `pending` | `in_progress` | `completed` | `blocked`
- Use `blocked_reason` when status is `blocked`