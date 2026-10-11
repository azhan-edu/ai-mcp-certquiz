---
name: get-question-explanation
description: Maintainer tool for inspecting the certquiz SQLite database - shows the correct answer of one question by its id, followed by the stored explanation. Use when the maintainer asks for the explanation or the right answer of a question (e.g. "explanation for question 42", "покажи объяснение вопроса 42"). It reveals the answer, so it must not be used to answer or help with a quiz question.
argument-hint: <question-id>
disable-model-invocation: true
---

# get-question-explanation

Reads one question from the local SQLite database and shows, in this order: the **correct answer** (letter and option text), then the stored **explanation**. Read-only: the database is opened with `readOnly: true`. The question text and all options come from `get-question`.

This is the only project skill that reads `options.is_correct`. That is a deliberate exception for the maintainer: it can only be started with the command `/get-question-explanation <id>` (`disable-model-invocation`), and it is not part of the quiz server, whose tools never expose the answer before `check_answer`.

## Parameter

- `$ARGUMENTS` = the question id: a positive integer, the `questions.id` column of the DB.
- This is the **database id**, not the `Qn` number from `raw-data/_shortNotesSource.md`. Question numbers are not stored in the DB, and ids differ from `Qn` because skipped questions get no row.
- If the argument is missing or is not a positive integer, ask the user for the id and stop.

## Procedure

1. Run (the id is passed as an argument, never interpolated into the code; the path comes from `DB_PATH`, default `data/certquiz.db`):

   ```bash
   node --env-file-if-exists=.env -e '
   const { DatabaseSync } = require("node:sqlite");
   const id = process.argv[1];
   if (!/^[1-9][0-9]*$/.test(id)) { console.error("question id must be a positive integer"); process.exit(2); }
   const path = process.env.DB_PATH || "data/certquiz.db";
   let db;
   try { db = new DatabaseSync(path, { readOnly: true }); } catch { console.error(`database not found or unreadable: ${path} (run npm run db:seed)`); process.exit(3); }
   const q = db.prepare("SELECT id, explanation FROM questions WHERE id = ?").get(Number(id));
   if (!q) { console.error(`no question with id ${id}`); process.exit(4); }
   const correct = db.prepare("SELECT position, label FROM options WHERE question_id = ? AND is_correct = 1").all(Number(id));
   if (correct.length !== 1) { console.error(`question ${id} has ${correct.length} correct options, expected exactly 1`); process.exit(5); }
   console.log(JSON.stringify({ id: q.id, correct: { letter: String.fromCharCode(64 + correct[0].position), label: correct[0].label }, explanation: q.explanation }));
   ' -- ID
   ```

   Replace `ID` with the validated id. The only option row read is the one marked correct; the other options are never read.
2. Show the result to the user in this format and nothing else (the correct answer first, then the explanation):

   ```
   **Question <id> — correct answer:** <letter>) <label>

   **Explanation:**

   <explanation>
   ```

3. On a non-zero exit code, show the error message from stderr as is and, for a missing database, suggest `npm run db:seed`. Exit code 5 means the data is inconsistent: report it, do not guess an answer.

## Rules

- This is a maintainer tool for inspecting the database. Never use it during a quiz session or to answer a quiz question for the user: it reveals the answer by design.
- The correct answer and the explanation are relayed exactly as stored: do not paraphrase, shorten, translate or add to them, and do not add your own judgement or a different answer.
- Do not modify the database and do not run any statement other than the two `SELECT`s and the one for the correct option above (`questions` by id, `options` where `is_correct = 1` for that question).
- Do not extend this to other skills or tools: `get-question` and `get-question-notes` must keep not reading `is_correct`.
- Show text verbatim, including source artifacts; do not "fix" wording.
