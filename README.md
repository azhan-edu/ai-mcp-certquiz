# certsafary

An educational (non-commercial) remote MCP server in TypeScript. It stores quiz questions by topic in a local SQLite database and gives a chat agent this flow:

random question → check answer → explanation (on request) → short note: how to understand the question (on request).

> Status: in development. Config, the DB schema and the question import (`raw-data/` → `raw-data/json/` by the `raw-data-to-json` skill → `npm run db:seed`) are ready. The resources and the read layer behind them are implemented (`db/repository.ts`, `services/quiz.ts`, `resources/`), but they are not wired to a server yet. The HTTP server and the tools are not implemented (there is no `src/index.ts`, `src/http.ts`, `src/server.ts`, `src/tools/`), so `npm run dev`, `npm run start` and connecting an agent do not work yet. Detailed plan: [docs/plan.md](docs/plan.md). The "Features", "Connecting an agent" and "Security" sections describe the target state.

## Features

**Tools**

| Tool | Input | Result |
|---|---|---|
| `list_topics` | — | topic list |
| `get_random_question` | `{ topicId? }` | question text and answer options (without the correctness flag) |
| `check_answer` | `{ questionId, optionId }` | `{ correct, correctOptionId }` |
| `get_explanation` | `{ questionId }` | explanation |
| `get_short_note` | `{ questionId }` | short note: how to understand the question; an error for a question without a note |

**Resources**

- `quiz://topics/{id}` — topic by id (`id`, `name`);
- `quiz://questions` — question list (not implemented yet);
- `quiz://questions/{id}` — question by id (`id`, text, options);
- `quiz://questions/{id}/short-notes` — short notes of a question.

Question resources, like `get_random_question`, do not contain the correct answer: only `check_answer` knows it. Short notes may hint at the answer and can be read at any time: the goal is learning, not knowledge control.

## Requirements

- Node.js 24+
- npm 11+

## Quick start

```bash
npm install
cp .env.example .env      # set MCP_AUTH_TOKEN
npx tsx .claude/skills/raw-data-to-json/convert.mts   # raw-data/*.md -> raw-data/json/ (or skill /raw-data-to-json)
npm run db:seed           # create the DB and load questions from raw-data/json/ into SQLite
npm run dev               # server at http://localhost:3000/mcp (not implemented yet)
```

## Configuration

Environment variables (read from `.env` via `node --env-file-if-exists` in the npm scripts):

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | HTTP server port | `3000` |
| `MCP_AUTH_TOKEN` | Bearer token for access to `/mcp` (not needed for `db:seed`) | required for the server |
| `DB_PATH` | path to the SQLite file | `data/certsafary.db` |
| `LOG_LEVEL` | pino log level (`fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`) | `info` |

With invalid configuration the server fails at startup with a clear error.

## Connecting an agent

The server uses Streamable HTTP (stateless) and expects the header `Authorization: Bearer <MCP_AUTH_TOKEN>`.

- Endpoint: `http://localhost:3000/mcp`
- Liveness check: `GET /health`
- Without a token `/mcp` responds with `401`

Example for a client with `.mcp.json`:

```json
{
  "mcpServers": {
    "certsafary": {
      "type": "http",
      "url": "http://localhost:3000/mcp",
      "headers": { "Authorization": "Bearer ${MCP_AUTH_TOKEN}" }
    }
  }
}
```

Debugging with MCP Inspector:

```bash
npm run inspect
```

## Data

The source of questions is the files in `raw-data/` (the format is described in `raw-data/_shortNotesRelation.md`):

| File | Contents |
|---|---|
| `_shortNotes.md` | short notes by exam domain |
| `_shortNotesSource.md` | exam questions with answer options, the answer and an explanation |
| `_shortNotesRelation.md` | description of the format and of the links between the files |

The `raw-data/` folder is not committed (it is in `.gitignore`): put the files there yourself. The DB schema is `src/db/schema.sql`: topics, notes, questions, answer options and the links between questions and notes (table `question_short_notes`: a note can belong to several questions, and a question can have several notes).

Only the `raw-data-to-json` skill reads the markdown files (`_shortNotes*.md`). The server, `db:seed` and the import read only `raw-data/json/`. The conversion step writes `raw-data/json/`: `topics.json`, `short_notes.json`, `questions.json`, `options.json`, `question_short_notes.json` and `_report.json` (required by `db:seed`). `options.json` contains the answer key, so this folder is git-ignored too and must not be shown to a quiz client.

### Importing data into the database

1. Put the files in `raw-data/`. The DB file path is set by `DB_PATH` (default `data/certsafary.db`); the folder and the file are created automatically.
2. Convert the markdown to JSON: `npx tsx .claude/skills/raw-data-to-json/convert.mts` (or the skill `/raw-data-to-json`). It writes `raw-data/json/` and prints the counts, the skipped questions and the number of warnings. Run it again after every edit of the markdown: `db:seed` reads only the JSON and does not see later changes to the markdown.
3. First check what will be loaded (dry run):

   ```bash
   npm run db:seed -- --dry-run
   ```

   Nothing is written: no rows, no schema, not even the DB file. If the DB file does not exist yet, the check runs in a temporary in-memory DB. The separate `--` is required, otherwise npm will not pass the flag to the script.
4. Read the report (the format is the same for a dry run and a real import; the `Qn` numbers come from `_report.json`, which is required: without it `db:seed` stops with an error):

   | Report line | Meaning |
   |---|---|
   | `parsed` | how many notes and questions are in the JSON, and out of how many `### Qn` blocks in the source (for example, `231/268`: 231 of 268 questions can be loaded) |
   | `inserted` | how many topics, notes, questions, options and links will be added (`N links` are question–note pairs; they are added also for questions that are already in the DB) |
   | `already present` | how many are already in the DB |
   | `changed in source` | records that are already in the DB but differ in the files (also a question whose DB link to a note is no longer in the files); they are not updated: questions are listed by number (`Qn`), notes by title, one per line |
   | `in database but not in source` | printed only when non-zero: rows that are in the DB but no longer in the files, for example after a typo fix in a question text or a topic rename. The new text is inserted as a new question and the old row stays. The line gives the number of questions (with their DB ids, up to 50 listed) and of topics; nothing is deleted |
   | `skipped` | skipped questions with numbers (`Qn`) and the reason, taken from `_report.json`; they were skipped by the conversion, so they are not in the JSON |
   | `warnings` | warnings about the source (the conversion writes them to `_report.json`, the seed prints them as they are; the seed also adds a warning for a topic without questions), for example: a `Заметки:` link that does not resolve to a note; a link between a question and a note that is known from one side only (`only from the notes side` / `only from the question side`; reported only for accepted questions); a note that lists a `Qn` with no block in the source (a typo); a note without `Вопросы:`; an unexpected heading that ends a question; a duplicate or empty note (skipped); an unclosed code fence |

5. Run the real import:

   ```bash
   npm run db:seed
   ```

6. Restart the server if it was running.

Other options:

```bash
npm run db:seed -- --json-dir path/to/json        # another folder with the JSON files (default raw-data/json)
DB_PATH=/tmp/test.db npm run db:seed -- --dry-run # another DB
```

How the import works:

- `db:seed` reads only `raw-data/json/`, never the markdown. Before it touches the DB it validates the JSON with zod. All six files are required (the five data files and `_report.json`). Checks: each file at most 50 MB; unique ids and natural keys (topic name, note title, topic + question text); existing references; at least two options per question; option positions exactly `1..n` and option labels unique within a question; exactly one correct option per question; `_report.json` counts equal to the row counts of the files, and `question_numbers` covers every question exactly once with unique numbers; a skipped reason or a warning longer than 300 characters is rejected. A missing folder or file stops it with `... Run /raw-data-to-json first.`; any other violation stops it with the file, the row and the rule. In both cases no DB file is created and nothing is written.
- The converter checks its own output with the same validation before it writes anything to `raw-data/json/`, and writes `_report.json` last. An interrupted run therefore leaves a set without a report, which `db:seed` rejects: run the conversion again.
- Hand edits of the JSON: ids are local to the export. If you change them by hand, renumber them consistently in all files together (`questions.json`, `options.json`, `question_short_notes.json`, `question_numbers`, `counts`). The seed matches rows by their natural keys, never by JSON ids, and the database assigns its own ids. Prefer fixing the markdown and converting again.
- Idempotent and add-only: a repeated run adds nothing, and existing rows are neither changed nor deleted. Missing question–note links are added also for questions that are already loaded; a link that the files no longer have is only reported. Everything runs in one transaction; on any error it is rolled back entirely.
- The conversion step skips a question, and the report lists it, if it cannot be built from the source as is: no answer options, no answer letter, no text, an empty option label, a duplicate option label, a duplicated text and other cases (the reason is given in the report). Without an official explanation (`> Official:`) the question's explanation is the text of a note from its own `Заметки:` line; `Заметки: —` means no note, so such a question without official text is skipped. Missing content is never invented: to load such a question, fix the source file and run the conversion again.
- A question is identified by the pair "topic + text". If you fix a typo in the text of an already loaded question, it is added as a new one and the old one stays; the report lists it under `in database but not in source`. To remove such rows, delete the DB file (the path from `DB_PATH`, default `data/certsafary.db`) and run `npm run db:seed` again: the DB is rebuilt from the JSON, so its ids change, and the server must be restarted afterwards. The JSON in `raw-data/json/` is used as it is, so run the conversion first if the markdown has changed. Table and index changes apply only when the DB is created: recreate an existing DB the same way (`db:seed` refreshes the triggers of an existing DB)..
- A dry run against an existing DB writes no data and does not switch its journal mode to WAL.
- The report contains only counters, note titles and question numbers, without the correct options.

Format rules (checked by the conversion, by the seed on the JSON and by the DB schema):

- a question has exactly one correct option (for a question with options, the DB guarantees it, including against `INSERT OR REPLACE` and `UPDATE OR REPLACE`: see `src/db/schema.sql`; a question with fewer than two options is rejected by the seed);
- empty fields are not allowed.

### Maintainer tools for the database

These skills are commands for the maintainer (`disable-model-invocation`). They only read the DB (`SELECT`), use the DB ids (`questions.id`, `topics.id`, not the `Qn` numbers) and must never be used during a quiz session. Commands:

- `/get-question [id]`: the topic, text and options of one question by id, or of a random question without an argument (no explanation, no answer);
- `/get-question-explanation <id>`: the correct answer, then the stored explanation (the only skill that reads the correct option);
- `/get-question-notes <id>`: all short notes of one question;
- `/get-stats [topic-id]`: counts of questions and short notes per category. Without an argument, only the summary; with a topic id, also the number of short notes per question.

Example of `/get-stats` (the output is in Russian; category names and rows are shortened here):

```
### Сводка по категориям
| ID категории | Категория | Вопросов | Шортноутов |
|---|---|---|---|
| 1 | … | 44 | 38 |
| … | … | … | … |
| | **Итого** | **231** | **158** |
```

The "Итого" row counts each distinct note once over the whole selection, so it is not the sum of the category rows (a note linked to questions of several categories is counted once). `/get-stats 1` adds the summary row of category 1 and a table `### Детали по вопросам` with one row per question: question id, first 100 characters of the text and the number of short notes.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | server with auto-restart (no `src/index.ts` yet) |
| `npm run start` | run from `dist/` (after `npm run build`; no `src/index.ts` yet) |
| `npm run build` | `tsc` build → `dist/` |
| `npm test` | unit and integration tests (Vitest) |
| `npm run lint` | Biome check |
| `npm run format` | Biome formatting (writes files) |
| `npm run typecheck` | `tsc --noEmit` |
| `npx tsx .claude/skills/raw-data-to-json/convert.mts` | convert `raw-data/*.md` to `raw-data/json/` (skill `/raw-data-to-json`) |
| `npm run db:seed` | create the DB and load questions from `raw-data/json/` (`--dry-run`, `--json-dir`) |
| `npm run inspect` | MCP Inspector |

## Git hooks

`npm install` installs a `pre-commit` hook (via `simple-git-hooks`, script `prepare`). It runs `scripts/pre-commit.mjs`:

1. blocks forbidden files in the commit: `.env`, `CLAUDE.local.md`, `.claude/settings.local.json`, `raw-data/**`, `data/*.db*` (the DB holds the answer key);
2. warns when `src/db/schema.sql` changes without seed, repository or test changes;
3. runs `biome check --staged`, `npm run typecheck` and `npm test`.

Skip it in an emergency with `git commit --no-verify`. Plan: [docs/plan.git-hooks.md](docs/plan.git-hooks.md).

## Architecture

```
src/
  index.ts      HTTP server entry point (planned)
  http.ts       Streamable HTTP, Bearer auth, /health (planned)
  server.ts     createServer(): registers tools and resources (planned; registerResources is ready)
  config.ts     env parsing (zod)
  db/           SQLite (node:sqlite): connection, schema.sql, seed-json (reads and validates JSON), import,
                report, run-seed, seed (db:seed CLI). Knows nothing about the markdown.
                repository.ts: read-only queries for the server: getTopic, listTopics, getQuestion, getRandomQuestionId,
                getCorrectOptionId (the only read of is_correct, used only by checkAnswer), getExplanation, getShortNotes
  services/     quiz logic: createQuizService(repo) with getTopic, listTopics, getQuestion, getRandomQuestion(topicId?),
                checkAnswer, getExplanation, getShortNotes, getShortNote (the service-level part of the tools is done;
                the tools themselves are planned)
  tools/        MCP tools — thin adapters over services (planned)
  resources/    MCP resources (implemented): registerResources(server, service) with quiz://topics/{id},
                quiz://questions/{id}, quiz://questions/{id}/short-notes; shared.ts: id parsing and error mapping
  lib/          errors.ts (AppError, ConfigError, NotFoundError), logger.ts (pino)
raw-data/       source files with questions and notes (not committed)
  json/         JSON for db:seed, written by the conversion; contains the answer key (not committed)
data/           SQLite file (not committed)
tests/          unit and integration (Vitest); skills/raw-data-to-json/ (parser and converter tests)
  unit/         repository, quiz service, import, seed and other unit tests
  integration/  resources.test.ts: resources through a client and InMemoryTransport
  helpers/      synthetic raw-data/json fixtures; unit/no-markdown-in-server.test.ts guards that src/ never names the markdown
.claude/skills/raw-data-to-json/convert.mts   conversion: raw-data/*.md -> raw-data/json/ (the only code that reads the markdown)
.claude/skills/raw-data-to-json/parser.ts     markdown parser used by convert.mts (part of the skill, not of src/)
```

`db/` and `services/` know nothing about MCP. The server keeps no user state: `createServer()` is called on every request.

## Stack

Node.js 24, TypeScript, `@modelcontextprotocol/sdk`, Express 5, `node:sqlite`, zod, pino, Biome, Vitest.

## Security

- The token is compared with `crypto.timingSafeEqual`.
- The `Origin`/`Host` headers are checked (DNS rebinding protection).
- Authorization and tokens do not end up in logs.
- Do not commit `.env`.
