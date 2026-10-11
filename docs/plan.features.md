# Feature list

Draft. Features are ordered by dependencies. Each feature is small and verifiable on its own, so it can be done as a separate commit.

## Stage 0. Foundation
| # | Feature | Result / done criteria |
|---|---|---|
| F0.1 | **Project skeleton**: `package.json`, tsconfig, Biome, Vitest, scripts (`dev`, `build`, `test`, `lint`, `typecheck`, `db:seed`, `inspect`), `.gitignore`, `.env.example` | `npm run lint`, `typecheck` and `test` pass on the empty project |
| F0.2 | **Config** (`config.ts`, `lib/errors.ts`, `lib/logger.ts`) | With an empty `MCP_AUTH_TOKEN` the server fails with a clear error. Logs go to stderr, the token is masked. |

## Stage 1. Data
| # | Feature | Result / done criteria |
|---|---|---|
| F1.1 | **DB schema** (`schema.sql`, `db/connection.ts`) | The database is created (tables `topics`, `short_notes`, `questions`, `options`, `question_short_notes` for the many-to-many link between questions and notes), `foreign_keys` is on; a topic with questions cannot be deleted (`ON DELETE RESTRICT`); the DB guarantees exactly one correct option for every question that has options (partial unique index and triggers: the correct option is inserted first and cannot be unmarked, moved or deleted while its question exists; INSERT OR REPLACE and UPDATE OR REPLACE on options and questions are refused by BEFORE triggers); a question with zero options is rejected by the seed validation and the import, not by the DB |
| F1.2 | **Conversion `raw-data/*.md` → `raw-data/json/`** (skill `raw-data-to-json`, `convert.mts`, parser `.claude/skills/raw-data-to-json/parser.ts`): question-to-note link by title (then by title prefix and line number; an unresolved link is always reported, there is no fallback to the notes' `Вопросы:` lines) | A question that cannot be built from the source is skipped, with the reason in `_report.json` (`Qn` and reason only); the output is checked with the same loader as `db:seed` before anything is written to `raw-data/json/`, and `_report.json` is written last (an interrupted run leaves no report, which the seed rejects) |
| F1.3 | **Seed script** `db:seed` (`--dry-run`, `--json-dir`): reads only `raw-data/json/`, validates it with zod (cross-file checks, exactly one correct option), then imports | The command is idempotent: a repeated run creates no duplicates; a missing JSON (including `_report.json`, which is required) stops it with `Run /raw-data-to-json first.` and creates no DB file; `_report.json` counts and `question_numbers` must match the files; the report prints `Qn` numbers; rows that are only in the DB are reported under `in database but not in source` and never deleted |
| F1.4 | **Repository** (`db/repository.ts`): random question (with a topic filter), by id, topic list, question list | **Partially done:** `getTopic`, `getQuestion` (with options) and `getShortNotes` have unit tests on `:memory:`; random question, topic list and question list are not done |
| F1.5 | **Skill `raw-data-to-json`** (`/raw-data-to-json`, or `npx tsx .claude/skills/raw-data-to-json/convert.mts`): the conversion of F1.2 as a skill with its procedure and rules | Same criteria as F1.2. The skill writes only under `raw-data/`, never touches the DB and never prints the contents of `options.json` or the correct option |
| F1.6 | **Skill `import-raw-data`** (`/import-raw-data`): runs F1.2 and then F1.3 (dry run first, then the real import) and a read-only check | Same criteria as F1.3. A repeated import reports 0 inserted. The check prints `without any option: 0`, `without exactly one correct: 0`, `fk violations: 0` and counts only |
| F1.7 | **Command `/get-question [id]`** (skill `get-question`, `disable-model-invocation`): one question by DB id (`questions.id`, not the `Qn` number); without an id, a random question | Shows the topic, the text and the options (letters A, B, ...), read-only. No explanation and no answer; the queries never select `explanation` or `is_correct`. Without an argument it picks a random question and shows its id. A non-positive or non-integer id is refused, an unknown id gives an error and exit code 4 (so does an empty database) |
| F1.8 | **Command `/get-question-explanation <id>`** (skill `get-question-explanation`): the correct answer, then the stored explanation | The only skill that reads `options.is_correct` (a maintainer-only exception, not used by the server). It reads only the one correct option row; if the question does not have exactly one correct option, it reports exit code 5 and guesses nothing |
| F1.9 | **Command `/get-question-notes <id>`** (skill `get-question-notes`): all short notes of a question (table `question_short_notes`) | Shows every note (title and text) ordered by note id, read-only; a question without notes gives "no short notes". The `options` table is not read. Note text is shown verbatim |
| F1.10 | **Command `/get-stats [topic-id]`** (skill `get-stats`): counts of questions and short notes | Without an argument: one row per category (category id, name, number of questions, number of **distinct** short notes) and an "Итого" row that counts distinct notes over the whole selection (not the sum of the rows). With a topic id (`topics.id`, not the `Qn` number): the summary row of that category and a details table (question id, first 100 characters of the question text with the category in the header, number of short notes). A non-integer argument is refused; an unknown id gives exit code 4. Read-only, counts only: never reads `options`, `is_correct`, `explanation` or note text. Maintainer tool, never used in a quiz session |

## Stage 2. Resources
| # | Feature | Result / done criteria |
|---|---|---|
| F2.1 | **Resource: topic** (template by topic id, e.g. `quiz://topics/{id}`) | **Done.** Returns all stored information about one question category (`topics.id`): today `id` and `name`. An unknown id gives a resource error. Reads through `services/` and `db/repository.ts`, no SQL in `resources/` |
| F2.2 | **Resource: question** (template by question id, e.g. `quiz://questions/{id}`) | **Done.** Returns only the question `id`, its `text` and its `options` (option `id` and `label`, ordered by `position`). No topic, no `is_correct`, no `explanation`. An unknown id gives an error. Covers the same ground as F4.7, see the note below |
| F2.3 | **Resource: short notes of a question** (template by question id, e.g. `quiz://questions/{id}/short-notes`) | **Done.** Returns all short notes of the question (title and text, ordered by note id); a question without notes returns an empty list; an unknown question id gives an error. Notes may hint at the answer; this is accepted: the goal is learning, not control, so the resource is readable at any time |

Stage 2 needs only the minimal server code: the repository and service functions for a topic, a question with options and a question's notes (a subset of F1.4 and F3.1), plus `registerResources`. `createServer()` (F4.1) is not required: tests build an `McpServer` directly and connect over `InMemoryTransport`. The rest of F1.4, F3.1 and F4.1 comes later. URI names are proposals. F2.2 overlaps with F4.7 (`quiz://questions` and `quiz://questions/{id}`); decide which one stays when implementing. F2.1 needs no schema change: it returns the columns `topics` has today. If `topics` gets new columns later, the resource returns them too; a schema change must then update the seed, the repository and the tests together.

## Stage 3. Logic
| # | Feature | Result / done criteria |
|---|---|---|
| F3.1 | **Quiz service** (`services/quiz.ts`): `getRandomQuestion`, `checkAnswer`, `getExplanation`, `getShortNote` | **Partially done:** `createQuizService` has `getTopic`, `getQuestion` and `getShortNotes` (unknown ids throw `NotFoundError`); `getRandomQuestion`, `checkAnswer`, `getExplanation` and `getShortNote` are not done. The public question DTO physically has no `is_correct` field. Covered by tests. |

## Stage 4. MCP interface
| # | Feature | Result / done criteria |
|---|---|---|
| F4.1 | **Server skeleton** (`server.ts`: `createServer()`, `registerTools`) | A client over `InMemoryTransport` connects and sees the tool list |
| F4.2 | **Tool `get_random_question`** (optional `topic`) | Returns the text and options without the correct answer |
| F4.3 | **Tool `check_answer`** (`questionId`, `optionId`) | Returns `correct` and `correctOptionId`; an unknown id gives `isError: true` |
| F4.4 | **Tool `get_explanation`** | Explanation of "why it is correct, why it is not" |
| F4.5 | **Tool `get_short_note`** | A short note on how to understand the question; a question without a note gives a clear error |
| F4.6 | **Tool `list_topics`** | Topic list |
| F4.7 | **Resources**: `quiz://questions` and the template `quiz://questions/{id}`, both without correct answers. Note: overlaps with F2.2; decide which one stays when implementing | Readable by a client; a non-existent id returns an error |

F4.2–F4.6 are independent of each other and can be done in any order after F4.1.

## Stage 5. Remote access
| # | Feature | Result / done criteria |
|---|---|---|
| F5.1 | **HTTP server**: Express 5 + Streamable HTTP, stateless, `/health`, entry point `index.ts` | MCP Inspector connects over HTTP |
| F5.2 | **Bearer authentication** (`timingSafeEqual`) | A request without a token or with a wrong one gets 401 |
| F5.3 | **DNS rebinding protection**: `Origin` and `Host` checks | A foreign Origin gets 403 |

## Stage 6. Quality and release
| # | Feature | Result / done criteria |
|---|---|---|
| F6.1 | **Integration tests** for the protocol and HTTP | The full scenario random → check → explanation → short note is green |
| F6.2 | **README**: how to run, env variables, connecting to a chat agent | The service can be brought up from scratch using the README |
| F6.3 | **npm package preparation**: `bin`, `files`, `engines`, `prepublishOnly`, `npm pack` check | The tarball contains `dist` and `schema.sql`; the DB file is not part of the package (`data` in `files` is debatable, see `plan.md`) |
| F6.4 | **Manual check with a real chat agent** | The scenario is passed by text and by voice |

## Out of scope (next stages)
CLAUDE.md with code rules, CI, deployment, OAuth 2.1, rate limiting, additional resources and prompts, user answer statistics (will require state storage).

## Recommended order
First build a **vertical slice**: F0.1 → F1.1–F1.4 → F3.1 → F4.1 → F4.2 → F4.3. This gives a minimally working quiz (question and check) inside the process, without the network. Then add the remaining tools, then HTTP and authentication.
