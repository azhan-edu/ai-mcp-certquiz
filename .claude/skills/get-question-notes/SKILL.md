---
name: get-question-notes
description: Maintainer tool for inspecting the certsafary database - shows all short notes related to one question, by question id. Use when the maintainer asks which short notes belong to a question, or to show the notes of question N (e.g. "notes for question 42", "покажи шорт-ноуты вопроса 42"). Must not be used to answer or help with a quiz question, because notes can hint at the answer.
argument-hint: <question-id>
disable-model-invocation: true
---

# get-question-notes

Shows the short notes (title and text) related to one question. Read-only.

## Parameter

- `$ARGUMENTS` = the question id: a positive integer, the `questions.id` column of the DB (not the `Qn` number from `raw-data/_shortNotesSource.md`; use `get-question` to see which question an id is).
- If the argument is missing or is not a positive integer, ask the user for the id and stop.

## Where the notes come from

The DB holds **all** notes of a question (table `question_short_notes`, many-to-many), so `raw-data/` is not needed.

## Procedure

1. Run one query (the id is passed as an argument, never interpolated into the code; the path comes from `DB_PATH`, default `data/certsafary.db`):

   ```bash
   node --env-file-if-exists=.env -e '
   const { DatabaseSync } = require("node:sqlite");
   const id = process.argv[1];
   if (!/^[1-9][0-9]*$/.test(id)) { console.error("question id must be a positive integer"); process.exit(2); }
   const path = process.env.DB_PATH || "data/certsafary.db";
   let db;
   try { db = new DatabaseSync(path, { readOnly: true }); } catch { console.error(`database not found or unreadable: ${path} (run npm run db:seed)`); process.exit(3); }
   let rows;
   try {
     rows = db.prepare("SELECT q.id AS question_id, q.text AS question_text, n.id AS note_id, n.title AS title, n.text AS text FROM questions q LEFT JOIN question_short_notes l ON l.question_id = q.id LEFT JOIN short_notes n ON n.id = l.short_note_id WHERE q.id = ? ORDER BY n.id").all(Number(id));
   } catch { console.error(`database not found or unreadable: ${path} (run npm run db:seed)`); process.exit(5); }
   if (rows.length === 0) { console.error(`no question with id ${id}`); process.exit(4); }
   console.log(JSON.stringify({ questionId: rows[0].question_id, questionText: rows[0].question_text, notes: rows.filter((r) => r.note_id !== null).map((r) => ({ title: r.title, text: r.text })) }));
   ' -- ID
   ```

   Replace `ID` with the validated id. The query never touches the `options` table, so no answer data is read.
2. Show the result:

   ```
   **Question <id>** — <first 100 characters of the text>…

   **Short notes (<count>):**

   ### <title>
   <text>
   ```

   Show every note. The notes are ordered by note id (the order of the notes file `_shortNotes.md`), not by the order of the `Заметки:` links in the source. If the question has no note, say "no short notes". On a non-zero exit code of step 1, show the stderr message as is; for a missing database suggest `npm run db:seed`.

## Rules

- This is a maintainer tool for inspecting the database. Notes can hint at the answer: never use it during a quiz session or to help answer a quiz question.
- Do not modify the database or the raw files; only `SELECT`s.
- Show note text verbatim; do not paraphrase, merge or "fix" it, and do not invent a note when none is found.
- Do not read or print `is_correct` or option contents, and do not say which option is correct.
- All notes come from the DB; do not read `raw-data/`.
