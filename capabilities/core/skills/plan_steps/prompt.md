# plan_steps (task plan + external memory)

The **skill input** in the delegated task is the source of truth. Read the JSON: you need `objective` (string).

## Goals

1. Produce an ordered plan with **stable ids** and statuses.
2. Design the plan so the **principal agent** can keep **facts out of the chat** by writing **workspace files** and recording **`artifact_path`** + short **`notes`** on each task—later steps **open those files** instead of "remembering" the transcript.
3. Identify tasks that can run **in parallel** and express their dependencies as a **DAG** (Directed Acyclic Graph).

## What you do

1. **read_task_plan** (`{}` or `{ "create_if_missing": true }`) if you need the current file before deciding merge vs replace.
2. From the objective, define **4–8 concrete steps** unless the goal is tiny. For each step set:
   - **`id`**: stable `snake_case` (e.g. `market_overview`, `swot_analysis`).
   - **`title`**: short label.
   - **`status`**: usually start as `pending` (or first step `in_progress` if appropriate).
   - **`artifact_path`** (recommended): where the principal should save **full** output for this step—**any file type**, e.g. `tasks/market_overview.md`, `tasks/competitors.json`, `tasks/chart.png`, `tasks/report.pdf`. Pick an extension that matches the deliverable. One path per task id.
   - **`instruction`** (required): clear, highly specific instructions for the worker sub-agent detailing what must be done to complete this step.
   - **`notes`** (optional): one or two sentences outlining key constraints, expectations, or planned outcomes.
   - **`depends_on`** (recommended): array of task IDs that must complete before this task starts. Leave empty `[]` or omit for tasks with no dependencies. Tasks without dependencies can run **in parallel**.
   - **`tool_names`** (recommended): array of tool names the worker sub-agent may use for this task (e.g. `["web_search", "write_file"]`, or include `read_pdf`, design tools, etc. when artifacts are non-text).
   - **`skill_names`** (optional): array of skill names the worker sub-agent may use.
3. **write_task_plan** with `{ "tasks": [ ... ] }` — **full replace** unless the objective says to extend an existing plan.
4. **patch_task_plan_task** for single-task updates (status, `notes`, `artifact_path`, `blocked_reason`) without rewriting the list.
5. **respond** to the principal: numbered steps, mention that **bulk evidence must be written to `artifact_path` files** during execution, and that **`read_task_plan`** plus the right read/open tools should drive later steps.

## Parallelism guidelines

When designing the plan, think about which tasks are **independent** and can run at the same time:

- Tasks that research **different topics** (e.g. market analysis + competitor analysis) → no dependency, run in parallel.
- Tasks that **synthesize or compare** results from prior tasks → set `depends_on` to those upstream task IDs.
- A final **summary/report** task should `depends_on` all content-producing tasks.

The principal agent can use `orchestrate_task_graph` to execute all parallelizable tasks simultaneously using worker sub-agents instead of running them one at a time.

## Status values

`pending` | `in_progress` | `completed` | `blocked` — use `blocked_reason` when `blocked`.

## Rules

- Do not invent a different objective than the skill input.
- Task-plan tools attach to the **principal session** when delegated.
- Prefer **one** `write_task_plan` after you finalize this planning pass unless you only patch.
- **Convention**: `tasks/<task_id>.<ext>` keeps artifacts aligned with plan ids; choose `<ext>` for the deliverable (.md, .json, .pdf, .png, …), not only markdown.
