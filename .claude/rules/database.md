---
paths:
  - "src/db/**"
  - "src/services/**"
  - "data/**"
---

# Database rules

- SQLite via `node:sqlite` (`DatabaseSync`). No ORM, no migrations; the schema lives in `src/db/schema.sql` with `CREATE TABLE IF NOT EXISTS`.
- All database access goes through `src/db/repository.ts`. `node:sqlite` types and SQL must not leak into `services/`, `tools/` or `resources/`.
- Prepared statements only. Never build SQL by concatenating or interpolating input.
- Connection: `PRAGMA foreign_keys = ON`, `journal_mode = WAL`. The server opens the DB with `readOnly: true`; only the seed script writes.
- Schema: `topics`, `questions`, `options`. Exactly one correct option per question, no empty fields. Any schema change is made together with `seed.ts`, `repository.ts` and tests.
- Queries that return a question to a client must not select `is_correct`.
- Question content comes from the user's `data/questions.json`. Never invent real questions; use clearly marked test data.

```ts
// right
const stmt = db.prepare("SELECT id, label FROM options WHERE question_id = ?");
const rows = stmt.all(questionId);

// wrong: injection risk and leaks the correctness flag
db.prepare(`SELECT * FROM options WHERE question_id = ${questionId}`).all();
```
