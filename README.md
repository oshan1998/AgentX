# AgentX

A modular AI agent runtime in Node.js + TypeScript — built around a **principal agent** that plans work, delegates to **specialized sub-agents**, and runs **parallel task graphs** when steps are independent.

AgentX is not a thin LLM wrapper. It is a full runtime: iterative decision loop, pluggable tools and skills, session and long-term memory, a web UI with live tracing, and a config-first skill layer you can extend without rewriting core code.

> **Recommended setup:** [Google Cloud Vertex AI](https://cloud.google.com/vertex-ai) — Gemini for text/vision, Imagen for image generation.

For deep architecture notes, see [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## How AgentX works

Every user session starts with one **principal agent** — the agent you talk to. It decides what to do next on each turn: call a tool, invoke a skill, write memory, delegate, or respond.

When work needs focus or parallelism, the principal agent brings in **sub-agents**:

| Mechanism | What it does |
|-----------|--------------|
| **`delegate_sub_agent`** | Spawns a focused sub-agent with a restricted tool/skill allowlist for one task |
| **Agentic skills** | Skills (e.g. `plan_steps`, `create_photo_social_graphic`) that run their own sub-agent internally |
| **`orchestrate_task_graph`** | Executes a DAG of tasks in parallel — each node runs as an isolated sub-agent |
| **`plan_steps` skill** | Builds an ordered task plan with dependencies, then feeds the graph to the orchestrator |

Sub-agents get their own session, iteration budget, and sandboxed permissions. They cannot write long-term memory or profiles — results flow back to the principal agent.

```
User
 └─► Principal Agent (AgentLoop)
       ├─► Tools          (read_file, web_search, generate_image, …)
       ├─► Workflow skills (summarize_document, resize_for_platforms, …)
       ├─► Agentic skills  (plan_steps, create_infographic, …)
       │     └─► Sub-agent (allowlisted tools + prompt.md)
       └─► Task graph orchestrator
             ├─► Sub-agent A  ─┐
             ├─► Sub-agent B  ─┼─► parallel workers
             └─► Sub-agent C  ─┘
```

---

## Prerequisites

- **Node.js** 20+ (tested on Node 22+)
- **npm**
- **Google Cloud project** with billing enabled (for Vertex AI)
- Optional: [Tavily](https://tavily.com) (web search), Gmail OAuth credentials, [Unsplash](https://unsplash.com/developers) (stock images)

---

## Quick start

### 1. Clone and install

```bash
git clone https://github.com/oshan1998/AgentX.git
cd AgentX
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your GCP project and any optional integration keys.

### 3. Authenticate with Google Cloud

Vertex AI uses [Application Default Credentials](https://cloud.google.com/docs/authentication/application-default-credentials):

```bash
gcloud auth application-default login
gcloud config set project YOUR_GCP_PROJECT_ID
```

Enable the **Vertex AI API** in your GCP project (covers Gemini and Imagen).

### 4. Start the server

```bash
npm run dev
```

Open **http://localhost:3000** — the built-in static UI, REST API, and WebSocket trace stream all run on this server.

For the **React dashboard** (recommended for day-to-day use), see [Frontend — AgentX-Frontend](#frontend--agentx-frontend) below.

---

## Frontend — AgentX-Frontend

The minimal React UI for interacting with AgentX lives in a separate repo. It is **not** bundled inside this backend project — clone it alongside AgentX or in its own directory.

| | |
|---|---|
| **Repository** | [github.com/oshan1998/AgentX-Frontend](https://github.com/oshan1998/AgentX-Frontend) |
| **Local path** (this monorepo) | `AgentX-Frontend/` |
| **Default dev URL** | http://localhost:5173 |
| **Backend** | AgentX on http://localhost:3000 |

### What it provides

- **Chat** — send messages to the agent; when the knowledge base has indexed documents, answers use RAG over the app corpus
- **Knowledge base** — upload PDF, TXT, MD, DOCX in the sidebar (separate from chat); files are indexed automatically via `POST /api/corpus/documents`
- **Reasoning feed** — live WebSocket trace of skills, tools, and run steps
- **Sessions** — create and switch conversations
- **Integrations** modal and task graph visualization

The built-in UI in `AgentX/ui/` is a lighter static alternative served from the same port as the API. **AgentX-Frontend** is the fuller dashboard most people use during development.

### Run the frontend

**1. Start the AgentX backend** (from this repo):

```bash
cd AgentX
npm run dev
```

**2. Clone and start the frontend:**

```bash
git clone https://github.com/oshan1998/AgentX-Frontend.git
cd AgentX-Frontend
npm install
npm run dev
```

Open **http://localhost:5173**. Vite proxies `/api` and `/ws` to `http://localhost:3000` (see `vite.config.ts`).

### Frontend scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite dev server (port 5173) |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview production build |

### Typical workflow

1. Upload documents in the sidebar **Knowledge Base** panel.
2. Wait until each document shows status **ready**.
3. Ask questions in chat — answers are grounded in the indexed corpus.
4. Watch the **Reasoning Feed** for retrieval and answer-generation steps.

---

## Recommended setup — Vertex AI (Gemini + Imagen)

One GCP project covers the principal agent, sub-agents, vision tools, and image generation.

### `.env`

```env
LLM_PROVIDER=gemini
GOOGLE_CLOUD_PROJECT=your-gcp-project-id
GOOGLE_CLOUD_LOCATION=us-central1
GEMINI_MODEL=gemini-2.5-flash

VISION_PROVIDER=gemini
IMAGE_GEN_PROVIDER=vertex
IMAGEN_MODEL=imagen-4.0-generate-001

PORT=3000
APP_BASE_URL=http://localhost:3000
```

### Model notes

| Use case | Config | Suggested model |
|----------|--------|-----------------|
| Principal + sub-agents | `GEMINI_MODEL` | `gemini-2.5-flash` |
| Vision / `inspect_image` | `GEMINI_VISION_MODEL` or `GEMINI_MODEL` | `gemini-2.5-flash` |
| Design agentic skills | `model` in `skill.json` | e.g. `gemini-2.5-pro` |
| Image generation | `IMAGEN_MODEL` | `imagen-4.0-generate-001` |

Per-skill model overrides live in each skill's `skill.json` — no extra env var needed.

### Try it

In the web UI:

```text
Search the web for the latest TypeScript release highlights and summarize them.
```

Requires `TAVILY_API_KEY` — see [Optional integrations](#optional-integrations).

---

## Optional integrations

```env
TAVILY_API_KEY=your_tavily_key

GMAIL_CLIENT_ID=your_client_id
GMAIL_CLIENT_SECRET=your_client_secret
GMAIL_REFRESH_TOKEN=your_refresh_token

UNSPLASH_ACCESS_KEY=your_unsplash_key
```

**Gmail OAuth:** create credentials in [Google Cloud Console](https://console.cloud.google.com/apis/credentials), set redirect URI to `http://localhost:3000/api/auth/gmail/callback`, then visit `/api/auth/gmail` after starting the server.

---

## Alternative LLM providers

| Provider | `LLM_PROVIDER` | Required env |
|----------|----------------|--------------|
| **Mock** (structure only) | `mock` or unset | — |
| **OpenAI** | `openai` | `OPENAI_API_KEY`, optional `OPENAI_MODEL` |
| **Ollama** (local) | `ollama` | `OLLAMA_API_BASE`, optional `OLLAMA_MODEL` |

Without a configured provider, AgentX boots with the mock adapter — enough to explore the codebase, not enough for real agent work.

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start HTTP server + WebSocket + UI (port 3000) |
| `npm run build` | Compile TypeScript |
| `npm run start` | Run compiled output |
| `npm run typecheck` | Type-check without emit |

---

## Capabilities

### Runtime

- Iterative **think → act → observe** loop with structured JSON decisions
- **Prompt builder** — session history, long-term memory, profiles, tool/skill catalogs
- **Memory** — per-session JSON + searchable long-term facts
- **Task plans** — structured DAGs in `memory/sessions/<id>/task-plan.json`
- **Web UI** + REST API + **WebSocket live tracing** of agent steps
- **Cron scheduler** — background jobs that trigger agent runs every 30s

### Agent coordination

- `delegate_sub_agent` — one-off delegated sub-agent with tool/skill allowlist
- `orchestrate_task_graph` — parallel DAG execution via worker sub-agents
- `plan_steps` — agentic skill that builds a task plan and can kick off orchestration
- `list_capabilities` — introspect available tools and skills

### Tools & skills (pluggable)

In-process tools load from `runtime/tools/`; domain tools from MCP servers in `mcp/`; skills from `skills/`.

| Domain | Tools (examples) | Skills (examples) |
|--------|------------------|-------------------|
| **Runtime (in-process)** | `ask_user`, `search_memory`, task-plan tools, `read_file`, `write_file`, cron CRUD | — |
| **Core skills** | — | `remember_fact`, `bootstrap_finalize`, `plan_steps` |
| **Filesystem skills** | — | `summarize_document`, `extract_tasks` |
| **Design (MCP)** | HTML/SVG render, image edit/generate, compose, crop | `create_photo_social_graphic`, `create_infographic`, `create_icon_set`, `resize_for_platforms` |
| **PDF (MCP)** | `read_pdf`, `generate_designed_pdf` | `generate_designed_pdf` |
| **Gmail (MCP)** | `list_emails`, `read_email`, `search_emails` | — |
| **Web (MCP)** | `web_search` (Tavily), `search_stock_images` | — |

### Skill types

- **Workflow skills** — fixed step sequences in `skill.json` (`tool_call`, `llm`, `respond`)
- **Agentic skills** — delegate to a sub-agent with allowlisted tools and a `prompt.md` persona

Example layout:

```text
skills/filesystem/summarize_document/
├── skill.json    # steps + metadata
└── prompt.md     # LLM instructions (agentic skills)
```

### LLM & media adapters

| Adapter | Providers |
|---------|-----------|
| Text decisions | **Gemini (Vertex)**, OpenAI, Ollama, mock |
| Vision | Gemini (Vertex), OpenAI |
| Image generation | Vertex Imagen |

---

## Project structure

```text
AgentX/
├── main.ts                    # HTTP server bootstrap
├── core/
│   ├── agent/                 # AgentLoop, Executor, PromptBuilder, delegation
│   ├── skills/                # Workflow + agentic skill runners
│   └── orchestrator/          # DAG scheduler, worker pool, parallel execution
├── runtime/
│   ├── tools/                 # In-process agent tools
│   └── services/              # Runtime helpers (cron store, …)
├── skills/                    # Domain skills (workflow + agentic)
├── mcp/                       # Standalone MCP domain servers (design, web, gmail)
├── controllers/               # HTTP controllers + services (chat, corpus, workspace, …)
├── llm-adapters/              # Gemini, OpenAI, Ollama, Imagen, mock
├── managers/                  # Memory, profile, tools, skills, secrets
├── common/                    # Interfaces, services, WebSocket tracing
├── memory/                    # Sessions, long-term memory, profiles, rag-corpus.json
├── workspace/                 # Per-session uploads and generated artifacts
└── ui/                        # Built-in static web UI (minimal; see AgentX-Frontend for React UI)
```

**React UI:** [AgentX-Frontend](https://github.com/oshan1998/AgentX-Frontend) — separate repo; minimal dashboard for chat, knowledge-base uploads, and live reasoning traces.

---

## Decision format

The LLM returns one JSON object per iteration:

```json
{
  "type": "tool_call",
  "tool": "read_file",
  "input": { "path": "./notes.txt" }
}
```

The loop ends when the agent responds:

```json
{
  "type": "respond",
  "message": "final answer"
}
```

Other decision types include `skill_call`, `memory_write`, and `profile_write`. See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full reference.

---

## Extending AgentX

**New in-process tool** — add `runtime/tools/my-tool.tool.ts` with `name`, `description`, and `run()`. Restart to auto-discover.

**New skill** — add `skills/<domain>/my_skill/skill.json` (+ optional `prompt.md`). Set `kind` to `workflow` or `agentic`.

**New MCP domain** — add tools under `mcp/<domain>/`, wire an `index.ts` harness entrypoint, and enable in `config/mcp-servers.json`.

No core code changes required for most extensions.
