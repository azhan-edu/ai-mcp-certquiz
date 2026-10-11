# Plan: GitHub Actions (server-side jobs after push)

Goal: run checks on GitHub after a push, so the local hook (`scripts/pre-commit.mjs`, see `plan.git-hooks.md`) cannot be bypassed with `--no-verify` and `main` stays green. Local hooks are out of scope here.

## Status

- Done: step 1 (`ci.yml`, skeleton), step 5 (`scheduled.yml`, `dependabot.yml`), step 6 (`main.yml`), step 7 (docs).
- Pending: step 2 (first run and red-run check), step 3 (branch protection), step 4 (`invariant`, `contract-snapshot`, `mcp-smoke`).
- Not stated: step 8 (verify and security review). To be clarified.

## Context

- Remote: `git@github.com:azhan-edu/ai-mcp-certsafary.git`. There is no `.github/` yet.
- `CLAUDE.md` currently says "no ... CI ... at this stage". When this plan is implemented, that line must be updated (step 7 of "Steps").
- `raw-data/` and `data/*.db*` are not in the repository (the answer key stays local). CI tests must run on fixtures (`tests/helpers/seed-json.ts`), never on real questions.
- Secrets (`.env`, Bearer token) are passed only through GitHub Secrets. The smoke test uses a throwaway token generated in the job.
- Node 24 (`engines.node >= 24`), npm, `npm ci` with the npm cache.

## Decisions

- One workflow file per trigger group, small jobs inside, so a failure points at one cause.
- Every job starts from the same steps: checkout, `actions/setup-node` (Node 24, `cache: npm`), `npm ci`. No reusable workflows or composite actions at this stage.
- Third-party actions are pinned to a major version tag; GitHub-owned actions are preferred.
- `permissions:` is set to `contents: read` at the top of each workflow; a job raises it only when it needs to.

## 1. On every push and every PR (`.github/workflows/ci.yml`)

Trigger: a push to **any branch** and a pull request to **any branch** (not only `main`):

```yaml
on:
  push:
    branches: ['**']
  pull_request:
```

A push to a branch with an open PR fires both events. To avoid double runs, use `concurrency` keyed by workflow and ref with `cancel-in-progress: true`.

Jobs (run in parallel unless noted):

| Job | What it does |
|---|---|
| `verify` | `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`. Matrix: Node 24 (add the next LTS later). |
| `invariant` | Runs only the "no answer leak" tests (`vitest run` with a name or path filter). Separate job, so the core invariant is a visible, required check. |
| `contract-snapshot` | Compares `tools/list` and `resources/list` against a committed snapshot. A diff means the public MCP contract changed. |
| `mcp-smoke` | Builds, starts the server on a free port with a throwaway Bearer token and a fixture DB, then calls `tools/list` and one `tools/call` over Streamable HTTP. Also checks that a request without the token gets 401. Needs `verify` (`needs: verify`). |
| `secret-scan` | `gitleaks` over the pushed commits. Checks content, which the local hook does not. |
| `pr-title` | PRs only (`if: github.event_name == 'pull_request'`). Checks the title or commit messages against Conventional Commits. |

Notes:

- `invariant`, `contract-snapshot` and `mcp-smoke` depend on tests that do not exist yet (no dedicated invariant test, no tools yet). Add each job together with its test; until then the workflow starts with `verify` and `secret-scan` only.
- After the first green run, mark `verify`, `invariant` and `secret-scan` as required checks in branch protection for `main`.

## 2. On a schedule (`.github/workflows/scheduled.yml` and `.github/dependabot.yml`)

Trigger: `schedule` (weekly, Monday night UTC) plus `workflow_dispatch` for a manual run.

| Job | What it does |
|---|---|
| `audit` | `npm audit --omit=dev --audit-level=high`. Fails on known high or critical vulnerabilities in production dependencies. |
| `codeql` | CodeQL analysis for JavaScript/TypeScript (`github/codeql-action`). Needs `security-events: write`. |
| Dependabot | Config file `.github/dependabot.yml`, not a workflow: weekly npm updates and weekly GitHub Actions updates. Group `@modelcontextprotocol/sdk` in its own PR, because it changes often and can alter the contract. |

Dependabot PRs go through job group 1, so the update is merged only if `verify`, `invariant` and `contract-snapshot` pass.

## 3. After merge into `main` (`.github/workflows/main.yml`)

Trigger: `push` to `main` only (a merged PR is a push to `main`).

| Job | What it does |
|---|---|
| `release-please` | `googleapis/release-please-action`: reads Conventional Commits, opens or updates a "release PR" with the version bump and `CHANGELOG.md`. Merging that PR creates the tag and a GitHub Release. Needs `contents: write` and `pull-requests: write`. |
| `build-artifact` | `npm run build`, then `npm pack`, and uploads the tarball with `actions/upload-artifact` (retention 14 days). Gives a downloadable build of exactly what is on `main`. |

Out of scope for now: publishing to npm on a `v*` tag (`npm publish --provenance`). It is added together with the `npm-release-checker` review, once `"private": true` is removed from `package.json`.

## 4. AI review (later, optional)

Not implemented now. Notes for later:

- Candidate: the Claude Code GitHub Action running `/code-review` and `/security-review` on a PR and posting the result as a comment.
- Advisory only, never a required check: an AI comment must not block a merge.
- Needs a repository secret with an API key. Decide the cost and who may trigger it (PRs from forks must not get the secret).
- The `quiz-invariant-reviewer` check stays a deterministic test in job `invariant`, not an AI review.

## Steps

1. **Skeleton.** Create `.github/workflows/ci.yml` with the trigger above, `concurrency`, and the jobs `verify` and `secret-scan`.
2. **Run it.** Push a branch, check that it runs once for push and PR, and that a failing test turns the run red.
3. **Branch protection.** On `main`: require the `verify` and `secret-scan` checks, forbid force-push.
4. **Contract jobs.** Add `invariant`, `contract-snapshot` and `mcp-smoke` as soon as the matching tests exist (each job in the same PR as its test).
5. **Scheduled.** Add `scheduled.yml` (`audit`, `codeql`) and `dependabot.yml`.
6. **After merge.** Add `main.yml` (`release-please`, `build-artifact`).
7. **Docs.** `docs-writer` removes "CI" from the not-at-this-stage line in `CLAUDE.md`, adds a CI section to `README.md` (which checks run, which are required), and links this plan from `docs/plan.md`.
8. **Verify.** `build-verifier` confirms the local `lint`, `typecheck`, `test` and `build` still pass; `security-auditor` reviews the workflows (permissions, secrets, fork PRs).

## Files

- New: `.github/workflows/ci.yml`, `.github/workflows/scheduled.yml`, `.github/workflows/main.yml`, `.github/dependabot.yml`, a snapshot file for `contract-snapshot` (location decided with its test), `CHANGELOG.md` (created by `release-please`)
- Changed: `CLAUDE.md`, `README.md`, `docs/plan.md`
- Unchanged: everything under `src/`

## Open questions (defaults in brackets)

1. Run group 1 on pushes to every branch, or only on PRs plus `main`? [every branch, as requested; `concurrency` limits the cost]
2. Add a second Node version to the `verify` matrix? [no, Node 24 only for now]
3. Use `release-please` or `changesets`? [`release-please`, it needs no extra files in the repo]
4. Pin third-party actions to a commit SHA instead of a major tag? [major tag now, SHA when the repo becomes public]
