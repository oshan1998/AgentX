# AgentX

Minimal but scalable single-agent framework in Node.js + TypeScript.

## What is implemented

- Core agent loop with iterative decision execution
- Sub-agent delegation and DAG task-graph orchestration
- Prompt builder with session + long-term memory + tools + skills context
- Memory system:
  - Session memory per JSON file in `memory/sessions/`
  - Long-term memory in `memory/long-term.json`
- Tool/skill executor with pluggable registries (auto-loaded from `capabilities/`)
- Session workspace file uploads (HTTP):
  - `POST /api/session/:id/files` — multipart `file` → `workspace/sessions/<id>/workspace/uploads/...`
  - `GET /api/session/:id/files` — list files in `uploads/`
  - Chat accepts `attachmentPaths` to tell the agent which workspace files to use
- File system capability:
  - Tools: `read_file`, `write_file`, `list_directory`, `download_file`
  - Skills: `summarize_document`, `extract_tasks`
- Scheduler capability:
  - Tools: `upsert_cron_job`, `list_cron_jobs`, `delete_cron_job`
  - Background runner: evaluates due cron jobs every 30s and executes their `task` via AgentLoop
- Hybrid skills:
  - Capability-owned skills via `capabilities/<capability>/skills/<skill-name>/skill.json`
  - Prompt layer via sibling `prompt.md`
  - Workflow vs agentic execution (`kind` in `skill.json`)
- Core capability tools:
  - `ask_user`, `search_memory`, `get_current_time`, `list_capabilities`
  - `delegate_sub_agent`, `orchestrate_task_graph`
  - Task plan (session file `memory/sessions/<id>.task-plan.json`): `read_task_plan`, `write_task_plan`, `patch_task_plan_task`
- Core capability skills:
  - `remember_fact`, `bootstrap_finalize` (onboarding)
  - `plan_steps` [agentic]: builds ordered steps and persists them via task-plan tools
- LLM adapters: mock (default), OpenAI, Ollama, Gemini (Vertex)
- HTTP + WebSocket UI (`main.ts`)

## Project structure

```text
agentX/
├── core/
│   ├── agent/           # agent loop, runtime factory, executor, prompts
│   ├── skills/          # skill loader + workflow/agentic runners
│   ├── orchestrator/    # DAG task graph execution
│   └── index.ts
├── capabilities/
│   ├── core/            # memory, task plans, delegation, orchestration
│   ├── filesystem/      # read/write/list/download + document skills
│   ├── rag/             # Vertex AI RAG Engine document Q&A
│   └── scheduler/       # cron job tools
├── common/
│   ├── interfaces/      # types + registries
│   ├── services/        # shared utilities
│   └── realtime/        # WebSocket trace hub
├── controllers/         # HTTP API layer
├── managers/            # memory, tools, skills, profiles
├── llm-adapters/
├── memory/
│   ├── sessions/
│   └── long-term.json
└── main.ts
```

## Run

1. Install dependencies:
   - `npm install`
2. Optional: set `OPENAI_API_KEY` in `.env`
3. Start server:
   - `npm run dev`
4. Open http://localhost:3000 in your browser

If no API key is set, AgentX uses a mock LLM adapter so the runtime still works.

### Environment example

```env
LLM_PROVIDER=openai   # openai | ollama | gemini | mock
OPENAI_API_KEY=your_openai_api_key_here

# Optional: Gemini via Vertex AI
GOOGLE_CLOUD_PROJECT=your_gcp_project
GOOGLE_CLOUD_LOCATION=us-central1
GEMINI_MODEL=gemini-1.5-flash

# Optional: Vertex AI RAG Engine (Serverless mode in us-central1)
GCP_BUCKET_NAME=your_document_bucket
GOOGLE_CLOUD_LOCATION=us-central1
# RAG_CORPUS_NAME=projects/.../locations/us-central1/ragCorpora/...  # reuse an existing corpus
# RAG_LOCATION=us-central1  # defaults to GOOGLE_CLOUD_LOCATION
# RAG_GEMINI_MODEL=gemini-2.5-flash

# Optional: local Ollama
OLLAMA_MODEL=qwen3:1.7b
OLLAMA_API_BASE=http://localhost:11434
```

## Decision format

The LLM must return one JSON object:

```json
{
  "type": "tool_call",
  "tool": "read_file",
  "input": {
    "path": "./notes.txt"
  }
}
```

Loop continues until:

```json
{
  "type": "respond",
  "message": "final answer"
}
```

## Hybrid skill layer

`Tools` are runtime abilities. `Skills` are config-first workflows built on tools.

Example:

- `capabilities/filesystem/skills/summarize_document/skill.json`: flow steps (`tool_call`, `llm`, `respond`)
- `capabilities/filesystem/skills/summarize_document/prompt.md`: behavior instructions for the LLM

## Vertex RAG documents

The RAG capability keeps the flow simple:

1. Upload a document to the session workspace with `POST /api/session/:id/files`.
2. Ask the agent to index it, or call the `index_document` tool with the workspace path.
3. Ask document questions through the `qa_document` skill or `ask_document` tool.

`index_document` uploads the original file to GCS and imports it into Vertex AI RAG Engine. Vertex handles parsing, chunking, embeddings, and corpus retrieval. If `RAG_CORPUS_NAME` is not set, AgentX creates a small corpus per session and records it in `memory/rag-sessions.json`.

On startup, AgentX switches the project to **Serverless mode** in `us-central1` (recommended for new projects). You can also switch manually in the GCP console: Vertex AI → RAG Engine → Switch to Serverless. If you previously created a corpus in another region, set `RAG_CORPUS_NAME` to a corpus in `us-central1` or clear `memory/rag-sessions.json`.

## Adding capabilities

Create a folder under `capabilities/<name>/tools/` with `*.tool.ts` files and optionally `capabilities/<name>/skills/<skill-name>/`. Tools and skills are discovered automatically at startup — no registry edits required.
