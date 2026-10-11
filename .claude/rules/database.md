---
paths:
  - "src/db/**"
  - "src/services/**"
  - "data/**"
  - "raw-data/**"
---

# Database rules

- SQLite via `node:sqlite` (`DatabaseSync`). No ORM, no migrations; the schema lives in `src/db/schema.sql` with `CREATE TABLE IF NOT EXISTS`.
- All database access goes through `src/db/repository.ts`. `node:sqlite` types and SQL must not leak into `services/`, `tools/` or `resources/`.
- Prepared statements only. Never build SQL by concatenating or interpolating input.
- Connection: `PRAGMA foreign_keys = ON`, `journal_mode = WAL`. The server opens the DB with `readOnly: true`; only the seed script writes.
- Schema: `topics`, `short_notes`, `questions`, `options`, `question_short_notes`. Exactly one correct option per question: the DB guarantees it for questions with options (partial unique index and triggers in `schema.sql`; the correct option is inserted first; BEFORE triggers refuse REPLACE paths on options and questions), zero options is checked by `seed-json.ts` and `import.ts`. Never use `INSERT OR REPLACE` or `UPDATE OR REPLACE` on `options` or `questions`. No empty fields. Any schema change is made together with `seed.ts`, `repository.ts` and tests.
- Queries that return a question to a client must not select `is_correct`.
- Question content comes from the user's `raw-data/` files. Never invent real questions, options or explanations; use clearly marked test data.
- Write side: `connection.ts` (open, schema), `seed-json.ts` (reads and validates `raw-data/json/`, including the required `_report.json`; the JSON is written by the `raw-data-to-json` skill, which alone reads `raw-data/_shortNotes*.md`, via its parser `.claude/skills/raw-data-to-json/parser.ts`; the server never reads the markdown), `import.ts` (additive, idempotent, one transaction), `report.ts` (import report text), `run-seed.ts` (`seedDatabase`: load JSON, import, safe cleanup) and `seed.ts` (CLI, `--dry-run`, `--json-dir`). They may use `node:sqlite` directly; reads for the server go through `repository.ts`. Import reports contain counts, question numbers (`Qn`), note titles and DB ids of rows missing from the source, never which option is correct.

```ts
// right
const stmt = db.prepare("SELECT id, label FROM options WHERE question_id = ?");
const rows = stmt.all(questionId);

// wrong: injection risk and leaks the correctness flag
db.prepare(`SELECT * FROM options WHERE question_id = ${questionId}`).all();
```
