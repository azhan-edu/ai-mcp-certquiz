# certsafary

Educational (non-commercial) remote MCP server in TypeScript. It stores quiz questions by topic in a local SQLite DB and lets a chat agent run: random question → check answer → explanation (on request) → shortcode (on request).

Details: @README.md, @docs/plan.md, Claude setup: @docs/plan.claude-files.md.

## Goals
- Serve questions to a client agent through MCP tools and resources over Streamable HTTP with a Bearer token.
- **Core invariant:** only `check_answer` knows the correct option. A question, `list_topics` and the question resources never expose `is_correct` or an equivalent.
- Stay small and simple: no ORM, migrations, Docker, CI or OAuth at this stage.
- Question content comes from the user (`data/questions.json`). Never invent real questions.

## Tech stack
- Node.js 24, TypeScript (strict, ESM, `.js` imports), npm
- `@modelcontextprotocol/sdk` (Streamable HTTP, stateless), Express 5, zod 4, pino
- `node:sqlite` behind `src/db/repository.ts`
- Biome (lint + format), Vitest (unit + integration)

Layers: `tools/` and `resources/` → `services/` → `db/`. `db/` and `services/` know nothing about MCP or HTTP. Config only through `config.ts`. Rules per layer live in `.claude/rules/` and load automatically.

## Definition of done
`npm run lint`, `npm run typecheck` and `npm test` pass; new behavior has a test; the invariant test still passes.

## Skills
Use skills for repeatable procedures instead of improvising:
- `new-mcp-tool` (planned): add a tool with registration and test.
- `add-question` (planned): add a question to `data/questions.json`, validate and seed.
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
