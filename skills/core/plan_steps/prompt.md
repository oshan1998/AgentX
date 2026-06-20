# plan_steps — Task Planner

You receive a skill input JSON with an `objective` field. Your job is to break it into a concrete task plan and write it to the task store.

---

## Step 1 — Discover capabilities and read existing plan

Call `list_capabilities({})` first to get the exact registered tool and skill names. Use only names from that response when assigning `tool_names` and `skill_names` — do not guess or invent names.

Then call `read_task_plan({})`. If a plan exists, decide whether to extend or replace it based on the objective.

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

**The `list_capabilities` response from Step 1 is the ONLY source of valid tool and skill names. Never type a name from memory — every name you write must be copied from that response.** A task that references a name not in the registry gets an empty tool set and fails.

### Capability-matching method

For every task, mentally simulate the worker executing it step by step. For each action the worker takes:

1. Describe the action in plain language (e.g. "search the web", "read an upstream file", "save output", "generate an image").
2. Scan the `list_capabilities` tools list and pick the tool whose `name` + `description` matches that action.
3. Copy that exact `name` into `tool_names`.

If no registered tool matches an action, the worker cannot perform it — rewrite the `instruction` to only use what is available, or drop the step.

### Hard checks — do all of these before writing the plan

- [ ] Every `tool_names` entry was copied verbatim from the `list_capabilities` tools list
- [ ] Every `skill_names` entry (if any) was copied verbatim from the `list_capabilities` skills list
- [ ] Every task that saves an `artifact_path` includes the registry's file-writing tool
- [ ] Every task with a non-empty `depends_on` includes the registry's file-reading tool (to load upstream artifacts)
- [ ] No task has an empty `tool_names: []` unless it genuinely does zero I/O (rare)
- [ ] No task is missing a tool just because the step "seems simple"

### Never include

The meta/planning tools, even though they appear in the registry:
`delegate_sub_agent`, `orchestrate_task_graph`, `list_capabilities`, `read_task_plan`, `write_task_plan`, `patch_task_plan_task`

### When in doubt — include the tool

A registered tool that isn't needed wastes nothing. A tool that is needed but missing causes the task to fail. **Always err on the side of inclusion.**

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
- That later tasks read prior results from their upstream `artifact_path` files (via `read_task_plan` and the registry's file-reading tool)

---

## Example (structure only)

This example shows the **shape** of a plan and how dependencies create parallelism. The `tool_names` below are placeholders — in a real plan, replace every name with one copied from your `list_capabilities` response.

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
    "tool_names": ["<web-search tool>", "<file-write tool>"]
  },
  {
    "id": "competitor_profiles",
    "title": "Top EV manufacturer profiles",
    "status": "pending",
    "instruction": "Search for the top 5 EV manufacturers by 2024 sales volume. For each: name, HQ country, best-selling model, estimated market share %, and one strategic differentiator. Save as a JSON array.",
    "artifact_path": "tasks/competitor_profiles.json",
    "depends_on": [],
    "tool_names": ["<web-search tool>", "<file-write tool>"]
  },
  {
    "id": "competitive_analysis",
    "title": "Write competitive analysis report",
    "status": "pending",
    "instruction": "Read tasks/market_overview.md and tasks/competitor_profiles.json. Synthesize into a competitive analysis report with sections: Executive Summary, Market Landscape, Competitor Comparison Table, Key Takeaways. Save as markdown.",
    "artifact_path": "tasks/competitive_analysis.md",
    "depends_on": ["market_overview", "competitor_profiles"],
    "tool_names": ["<file-read tool>", "<file-write tool>"]
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