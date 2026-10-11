---
name: get-question
description: Maintainer tool for inspecting the certsafary SQLite database - shows one stored question (topic, question text and answer options only; no explanation, no answer): the one with the given id, or a random one when no id is given. Use when the maintainer asks to show, get, read or look up a question by id, or to show a random question (e.g. "get question 42", "покажи вопрос 42", "случайный вопрос"). Must not be used to answer or help with a quiz question.
argument-hint: [question-id]
disable-model-invocation: true
---

# get-question

Reads one question (by id, or a random one) from the local SQLite database and shows its topic, text and answer options (A, B, C...). It does **not** return the explanation (use `get-question-explanation` for that) and never the answer. Read-only: the database is opened with `readOnly: true`.

## Parameter

- `$ARGUMENTS` = optional question id: a positive integer, the `questions.id` column of the DB.
- No argument: a random question from the whole database (`ORDER BY RANDOM() LIMIT 1`); the output shows its id, so the maintainer can pass it to the other commands.
- This is the **database id**, not the `Qn` number from `raw-data/_shortNotesSource.md`. Question numbers are not stored in the DB, and ids differ from `Qn` because skipped questions get no row.
- If the argument is present but is not a positive integer, say that the question id must be a positive integer and stop.

## Procedure

1. Run (the id is passed as an argument, never interpolated into the code; the path comes from `DB_PATH`, default `data/certsafary.db`):

   ```bash
   node --env-file-if-exists=.env -e '
   const { DatabaseSync } = require("node:sqlite");
   const arg = process.argv[1];
   if (arg !== undefined && !/^[1-9][0-9]*$/.test(arg)) { console.error("question id must be a positive integer"); process.exit(2); }
   const path = process.env.DB_PATH || "data/certsafary.db";
   let db;
   try { db = new DatabaseSync(path, { readOnly: true }); } catch { console.error(`database not found or unreadable: ${path} (run npm run db:seed)`); process.exit(3); }
   const base = "SELECT q.id, q.text, t.name AS topic FROM questions q JOIN topics t ON t.id = q.topic_id";
   let q;
   try { q = arg === undefined ? db.prepare(`${base} ORDER BY RANDOM() LIMIT 1`).get() : db.prepare(`${base} WHERE q.id = ?`).get(Number(arg)); } catch { console.error(`database not found or unreadable: ${path} (run npm run db:seed)`); process.exit(5); }
   if (!q) { console.error(arg === undefined ? "no questions in the database (run npm run db:seed)" : `no question with id ${arg}`); process.exit(4); }
   const options = db.prepare("SELECT position, label FROM options WHERE question_id = ? ORDER BY position").all(q.id);
   console.log(JSON.stringify({ id: q.id, topic: q.topic, text: q.text, options: options.map((o) => ({ letter: String.fromCharCode(64 + o.position), label: o.label })) }));
   ' -- ID
   ```

   Omit `-- ID` when there is no argument; otherwise replace `ID` with the validated id. The queries select `id, text, topic` and `position, label` only: never `explanation`, never `is_correct`.
2. Show the result to the user in this format and nothing else:

   ```
   **Question <id>** — <topic>

   <text>

   A) <label>
   B) <label>
   ...
   ```

3. On a non-zero exit code, show the error message from stderr as is and, for a missing database, suggest `npm run db:seed`.

## Rules

- This is a maintainer tool for inspecting the database. Never use it during a quiz session or to answer a quiz question for the user.
- Return only the question text and the options. Do not add the explanation, the answer, a hint, or your own opinion on which option is right; if the user wants the explanation, point to `/get-question-explanation <id>`.
- Do not modify the database and do not run any statement other than the two `SELECT`s above.
- Do not select or print `explanation` or `is_correct`; this skill must keep working the same way if the schema later gains more columns.
- Show text verbatim, including source artifacts; do not "fix" wording.
