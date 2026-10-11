# certquiz

Educational (non-commercial) remote MCP server in TypeScript. It stores quiz questions by topic in a local SQLite DB and lets a chat agent run: random question → check answer → explanation (on request) → short note (on request).

Details: @README.md, @docs/plan.md, Claude setup: @docs/plan.claude-files.md.

## Goals
- **Purpose is learning, not knowledge control.** Short notes may hint at the answer and are readable at any time (tool and resource). This does not relax the invariant below.
- Serve questions to a client agent through MCP tools and resources over Streamable HTTP with a Bearer token. Prompts are ready-made instructions that tell the agent which tool to call; they carry no data.
- **Core invariant:** only `check_answer` knows the correct option. A question, `list_topics` and the question resources never expose `is_correct` or an equivalent.
- Stay small and simple: no ORM, migrations, Docker or OAuth at this stage.
- GitHub Actions are partly in place (`.github/workflows/`); status and remaining jobs: @docs/plan.github-actions.md.
- Question content comes from the user (`raw-data/` → `raw-data/json/` via `/raw-data-to-json` → `npm run db:seed`). Never invent real questions, options or explanations.
- `raw-data/_shortNotes*.md` are read only by the skill `raw-data-to-json` (its parser lives in `.claude/skills/raw-data-to-json/`). The server, `db:seed` and the import use only `raw-data/json/`; `src/` never references the markdown files or `.claude/`.

## Tech stack
- Node.js 24, TypeScript (strict, ESM, `.js` imports), npm
- `@modelcontextprotocol/sdk` (Streamable HTTP, stateless), Express 5, zod 4, pino
- `node:sqlite`; server reads go through `src/db/repository.ts` (created: `getTopic`, `listTopics`, `getQuestion`, `getRandomQuestionId`, `getCorrectOptionId`, `getExplanation`, `getShortNotes`)
- Biome (lint + format), Vitest (unit + integration)

Layers: `tools/`, `resources/` → `services/` → `db/`; `prompts/` are data-free (no dependency on `services/` or `db/`). `db/` and `services/` know nothing about MCP or HTTP. Config only through `config.ts`. Rules per layer live in `.claude/rules/` and load automatically.

## Definition of done
`npm run lint`, `npm run typecheck` and `npm test` pass; new behavior has a test; the invariant test still passes. The `pre-commit` git hook (`scripts/pre-commit.mjs`) runs lint, typecheck and tests and blocks secrets, `raw-data/` and `data/*.db*`; don't bypass it with `--no-verify` unless the user asks.

## Skills
Use skills for repeatable procedures instead of improvising:
- `new-mcp-tool` (planned): add a tool with registration and test.
- `import-raw-data` (`.claude/skills/`): create/update the DB: runs `raw-data-to-json`, then `npm run db:seed` (dry run first).
- `raw-data-to-json` (`.claude/skills/`): convert `raw-data/` into JSON files that mirror the schema tables; writes only under `raw-data/` (the output holds the answer key), never touches the DB.
- `get-question [id]` (command only) (`.claude/skills/`): show a question's text and answer options by DB id, or a random question when no id is given (read-only; no explanation, no answer). Maintainer tool only: never use it during a quiz session.
- `get-question-explanation <id>` (command only) (`.claude/skills/`): show the correct answer and then the stored explanation of a question by DB id (read-only). The only skill that reads `is_correct`, a deliberate maintainer-only exception: never use it during a quiz session.
- `get-question-notes <id>` (command only) (`.claude/skills/`): show all short notes of a question by DB id (from the DB, table `question_short_notes`). Maintainer tool only: never use it to help with a quiz question.
- `get-stats [topic-id]` (command only) (`.claude/skills/`): show counts of questions and short notes per category (topic), plus a per-question note count when a topic id is given, from the DB (read-only; counts only, no options, no answer). Maintainer tool only: never use it during a quiz session.
- `/code-review`, `/security-review`, `/simplify`: before a commit, after the HTTP layer, and after large edits.

## Agents
Delegate to `.claude/agents/` for large, isolated tasks; do small edits yourself.

| Task | Agent |
|---|---|
| New tool or resource | `mcp-developer` |
| HTTP layer, config, services | `backend-developer` |
| Schema, repository, seed | `db-engineer` |
| Write or run tests | `test-engineer` |
| Review a diff | `code-reviewer` |
| Check no answer leaks | `quiz-invariant-reviewer` (after any change to tools, resources, services, db) |
| Auth, secrets, logs | `security-auditor` |
| Review SQL and schema | `db-reviewer` |
| Run lint, typecheck, tests, build | `build-verifier` |
| Before npm publish | `npm-release-checker` |
| Sync docs with code | `docs-writer` |

Reviewer agents are read-only. Pass them the files or diff to look at; restate critical rules (the invariant) in the delegation prompt.

**Always name the agent.** Before delegating, and again when reporting its result, state the agent's name (e.g. "Delegating to `db-engineer`…", "`code-reviewer` found…"). If work is done in the main session without an agent, say so.

## Feature workflow
The main session drives the sequence (subagents cannot call other subagents). Skip steps that don't apply; do small edits yourself.
1. **Understand:** read `docs/plan.md`; for a large feature, plan first (Plan/Explore agents).
2. **Data:** schema or question changes go to `db-engineer`, then `db-reviewer`.
3. **Code:** `mcp-developer` for tools/resources, `backend-developer` for HTTP, config, services. Layer rules load from `.claude/rules/`.
4. **Tests:** `test-engineer` writes and runs them, including the invariant test.
5. **Verify:** `build-verifier` runs lint, typecheck, tests, build.
6. **Review:** `code-reviewer` on the diff, `quiz-invariant-reviewer` for answer leaks, `security-auditor` for HTTP/auth changes.
7. **Fix:** address findings, repeat steps 5–6 until clean.
8. **Wrap up:** `docs-writer` syncs README and plan, then commit (only when the user asks).

## Don'ts
- Don't commit `.env`, tokens or `CLAUDE.local.md`.
- Don't change `schema.sql` without updating the seed, repository and tests.
- Don't weaken or delete a test to make it pass.
