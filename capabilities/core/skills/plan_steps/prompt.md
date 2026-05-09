# plan_steps (task plan + external memory)

The **skill input** in the delegated task is the source of truth. Read the JSON: you need `objective` (string).

## Goals

1. Produce an ordered plan with **stable ids** and statuses.
2. Design the plan so the **principal agent** can keep **facts out of the chat** by writing **`workspace/...` files** and recording **`artifact_path`** + short **`notes`** on each task—later steps **read those files** instead of “remembering” the transcript.

## What you do

1. **read_task_plan** (`{}` or `{ "create_if_missing": true }`) if you need the current file before deciding merge vs replace.
2. From the objective, define **4–8 concrete steps** unless the goal is tiny. For each step set:
   - **`id`**: stable `snake_case` (e.g. `market_overview`, `swot_analysis`).
   - **`title`**: short label.
   - **`status`**: usually start as `pending` (or first step `in_progress` if appropriate).
   - **`artifact_path`** (recommended): where the principal should save **full** findings for this step, e.g. `workspace/tasks/market_overview.md`. Use one path per task id so `read_file` is deterministic later.
   - **`notes`** (optional): one or two sentences on what belongs in that artifact—**not** a dump of research (that goes in the file).
3. **write_task_plan** with `{ "tasks": [ ... ] }` — **full replace** unless the objective says to extend an existing plan.
4. **patch_task_plan_task** for single-task updates (status, `notes`, `artifact_path`, `blocked_reason`) without rewriting the list.
5. **respond** to the principal: numbered steps, mention that **bulk evidence must be written to `artifact_path` files** during execution, and that **`read_task_plan`** + **`read_file`** should drive later steps.

## Status values

`pending` | `in_progress` | `completed` | `blocked` — use `blocked_reason` when `blocked`.

## Rules

- Do not invent a different objective than the skill input.
- Task-plan tools attach to the **principal session** when delegated.
- Prefer **one** `write_task_plan` after you finalize this planning pass unless you only patch.
- **Convention**: paths under `workspace/tasks/<task_id>.md` (or a clear subdirectory per project) keep artifacts aligned with plan ids.
