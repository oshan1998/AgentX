# Agentix

Minimal but scalable single-agent framework in Node.js + TypeScript.

## What is implemented

- Core agent loop with iterative decision execution
- Prompt builder with session + long-term memory + tools + skills context
- Memory system:
  - Session memory per JSON file in `memory/sessions/`
  - Long-term memory in `memory/long-term.json`
- Tool/skill executor with pluggable registries
- File system connector:
  - Tools: `read_file`, `write_file`, `list_directory`
- Hybrid skills:
  - Global config skills via `skills/<skill-name>/skill.json`
  - Connector-owned skills via `connectors/<connector>/skills/<skill-name>/skill.json`
  - Prompt layer via sibling `prompt.md`
  - Optional advanced TS skills for custom logic (not required for current built-ins)
- Built-in tools:
  - `ask_user`, `search_memory`
- Built-in skills:
  - `remember_fact`, `plan_steps`
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
├── connectors/
│   └── filesystem/
│       └── tools/
├── interfaces/
├── memory/
│   ├── sessions/
│   └── long-term.json
├── skills/
├── tools/
└── main.ts
```

## Run

1. Install dependencies:
   - `npm install`
2. Optional: set `OPENAI_API_KEY` in `.env`
3. Start CLI:
   - `npm run dev`
4. Start UI:
   - `npm run ui`
   - Open http://localhost:3000 in your browser

If API key is missing, Agentix uses a mock LLM adapter so the runtime still works.

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

`Tools` are code capabilities. `Skills` can be config-first workflows.

Example:

- `skills/summarize_document/skill.json`: flow steps (`tool_call`, `llm`, `respond`)
- `skills/summarize_document/prompt.md`: behavior instructions for the LLM
- `skills/advanced/*.ts`: optional advanced override when config is not enough
