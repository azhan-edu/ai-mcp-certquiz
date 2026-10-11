# Plan: git hooks

Goal: run checks automatically before every commit, so broken or unsafe changes do not enter the history. Git hooks only (no Claude Code hooks).

## Context

- `raw-data/` is already in `.gitignore`, so the answer key in `raw-data/json/` is not committed. No separate hook is needed for it, only a guard against `git add -f`.
- `data/*.db` is commented out in `.gitignore`. The DB contains `is_correct`, so the hook blocks it.
- Checks reuse the existing scripts in `package.json`: `lint`, `typecheck`, `test`.

## Decisions

- **Tool:** `simple-git-hooks`, no Husky. Hooks are declared in `package.json` and installed by the `prepare` script on `npm install`.
- **No lint-staged.** Biome checks staged files itself (`biome check --staged`).
- **Tests run in pre-commit,** as requested. The suite is small (seconds). If it gets slow, move tests to pre-push.
- **Escape hatch:** `git commit --no-verify`.

## Steps

1. **Dependency and install**
   - `npm i -D simple-git-hooks`
   - Add the script `"prepare": "simple-git-hooks"`.

2. **Hook config** in `package.json`, block `simple-git-hooks`:
   - `pre-commit`: `node scripts/pre-commit.mjs`

3. **Script `scripts/pre-commit.mjs`.** Runs the checks in order and stops at the first failure:
   1. Forbidden-files check (step 4).
   2. `biome check --staged --no-errors-on-unmatched` (staged files only).
   3. `npm run typecheck`
   4. `npm test`

4. **Forbidden files.** Read the staged list (`git diff --cached --name-only`) and block the commit if it contains:
   - `.env` (but not `.env.example`)
   - `CLAUDE.local.md`, `.claude/settings.local.json`
   - `raw-data/**` (guards against `git add -f`)
   - `data/*.db`, `data/*.db-*` (the DB holds the answer key)

   Content scanning for tokens (e.g. `gitleaks`) is out of scope for now.

5. **`schema.sql` warning (non-blocking).** If `src/db/schema.sql` is staged but no seed, `repository.ts` or `tests/` change is staged with it, print a warning. This supports the rule "don't change `schema.sql` without updating the seed, repository and tests".

6. **Verification**
   - A commit with a lint error, a failing test, or `.env` staged is blocked.
   - A clean commit passes.
   - `--no-verify` bypasses the hook.

7. **Docs.** `docs-writer` adds a hooks section to `README.md` (install via `npm install`, how to bypass) and a line to `CLAUDE.md`.

## Files

- New: `scripts/pre-commit.mjs`
- Changed: `package.json`, `package-lock.json`, `README.md`, `CLAUDE.md`
- Unchanged: everything under `src/`

## Workflow

Done in the main session without subagents. `build-verifier` runs lint, typecheck and tests at the end.

## Open questions (defaults in brackets)

1. Block `data/*.db` in the hook? [yes]
2. Keep the `schema.sql` warning? [yes]
