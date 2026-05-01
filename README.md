# AgentX

Minimal but scalable single-agent framework in Node.js + TypeScript.

## What is implemented

- Core agent loop with iterative decision execution
- Prompt builder with session + long-term memory + tools + skills context
- Memory system:
  - Session memory per JSON file in `memory/sessions/`
  - Long-term memory in `memory/long-term.json`
- Tool/skill executor with pluggable registries
- File system capability:
  - Tools: `read_file`, `write_file`, `list_directory`
- Scheduler capability:
  - Tools: `upsert_cron_job`, `list_cron_jobs`, `delete_cron_job`
  - Background runner: evaluates due cron jobs every 30s and executes their `task` via AgentLoop
- Gmail integration:
    - Tools: `list_emails`, `read_email`, `search_emails`
- Web search integration:
    - Tools: `web_search` (Tavily)
- Hybrid skills:
  - Capability-owned skills via `capabilities/<capability>/skills/<skill-name>/skill.json`
  - Integration-owned skills via `integrations/<integration>/skills/<skill-name>/skill.json`
  - Prompt layer via sibling `prompt.md`
  - Optional advanced TS skills for custom logic (not required for current capabilities/integrations)
- Core capability tools:
  - `ask_user`, `search_memory`, `get_current_time`
- Core capability skills:
  - `remember_fact`, `plan_steps`, `bootstrap_finalize` (onboarding)
- Filesystem skills (multi-step): `summarize_document`, `extract_tasks`
- PDF skill: `generate_designed_pdf`
- OpenAI adapter plus mock adapter fallback
- Interactive CLI (`main.ts`)

## Project structure

```text
agentix/
├── core/
│   ├── agent-loop.ts
│   ├── executor.ts
│   ├── llm-adapter.ts
│   ├── memory-manager.ts
│   ├── mock-llm-adapter.ts
│   └── prompt-builder.ts
├── capabilities/
│   ├── core/
│   │   ├── tools/
│   │   └── skills/
│   ├── filesystem/
│       ├── tools/
│       └── skills/
│   └── scheduler/
│       ├── tools/
│       └── skills/
├── integrations/
│   ├── gmail/
│   │   ├── tools/
│   │   └── skills/
│   └── web-search/
│       ├── tools/
│       └── skills/
├── interfaces/
├── memory/
│   ├── sessions/
│   └── long-term.json
└── main.ts
```

## Run

1. Install dependencies:
   - `npm install`
2. Optional: set `OPENAI_API_KEY` in `.env`
   - For Tavily web search, also set `TAVILY_API_KEY` in `.env`
3. Start CLI:
   - `npm run dev`
4. Start UI:
   - `npm run ui`
   - Open http://localhost:3000 in your browser

If API key is missing, Agentix uses a mock LLM adapter so the runtime still works.

### Tavily example

Add this to `.env`:

```env
TAVILY_API_KEY=your_tavily_api_key_here
GMAIL_API_KEY=your_gmail_api_key_here
GMAIL_CLIENT_ID=your_gmail_client_id_here
GMAIL_CLIENT_SECRET=your_gmail_client_secret_here
GMAIL_REFRESH_TOKEN=your_gmail_refresh_token_here
LLM_PROVIDER=openai or ollama(for local)
OPENAI_API_KEY=your_openai_api_key_here

```

Then in the CLI, ask:

```text
Search the web for the latest TypeScript 5.7 release highlights.
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
- `skills/advanced/*.ts`: optional advanced override when config is not enough
