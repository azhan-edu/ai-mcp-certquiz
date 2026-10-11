---
name: get-stats
description: Maintainer tool for inspecting the certquiz database - shows how many questions and short notes each category (topic) has, plus, when a topic id is given, a per-question count of short notes. Optional argument is a topic id; without it only the summary of all categories is shown. Use when the maintainer asks for statistics, counts or coverage (e.g. "stats", "статистика по категориям", "сколько вопросов в категории 2"). Counts only: never shows answers, options or note text.
argument-hint: [topic-id]
disable-model-invocation: true
---

# get-stats

Shows statistics of the database: questions and short notes per category, and per question for one category. Read-only, numbers only.

## Parameter

- `$ARGUMENTS` = optional category number: a positive integer, the `topics.id` column of the DB (not the `Qn` number from `raw-data/_shortNotesSource.md`).
- No argument: the summary of all categories, without details.
- With an argument: the summary row of that category and the details of its questions.
- Present but not a positive integer: say that the topic id must be a positive integer and stop.

## What it returns

Printed by the script as ready markdown tables:

1. **Summary by category**: a table of four columns: category id, category name, number of questions, number of **distinct** short notes linked to the questions of the category (a note linked to several questions counts once). Categories without questions show 0. The last row "Итого" counts distinct notes over the whole selection, so it is not the sum of the rows.
2. **Details by question** (only when a topic id is given): a table of three columns: question id, question (the first 100 characters of its text) and the number of short notes linked to that question (0 if none). The category (id and name) is in the header of the question column.

## Procedure

1. Run one script (the topic id is passed as an argument, never interpolated into the code or SQL; the path comes from `DB_PATH`, default `data/certquiz.db`). Run it from the project root:

   ```bash
   node --env-file-if-exists=.env -e '
   const { DatabaseSync } = require("node:sqlite");
   const arg = process.argv[1];
   if (arg !== undefined && !/^[1-9][0-9]*$/.test(arg)) { console.error("topic id must be a positive integer"); process.exit(2); }
   const topic = arg === undefined ? null : Number(arg);
   const path = process.env.DB_PATH || "data/certquiz.db";
   let db;
   try { db = new DatabaseSync(path, { readOnly: true }); } catch { console.error(`database not found or unreadable: ${path} (run npm run db:seed)`); process.exit(3); }
   let groups, total, details = [];
   try {
     groups = db.prepare("SELECT t.id AS id, t.name AS name, COUNT(DISTINCT q.id) AS questions, COUNT(DISTINCT l.short_note_id) AS notes FROM topics t LEFT JOIN questions q ON q.topic_id = t.id LEFT JOIN question_short_notes l ON l.question_id = q.id WHERE (? IS NULL OR t.id = ?) GROUP BY t.id ORDER BY t.id").all(topic, topic);
     total = db.prepare("SELECT COUNT(DISTINCT q.id) AS questions, COUNT(DISTINCT l.short_note_id) AS notes FROM questions q LEFT JOIN question_short_notes l ON l.question_id = q.id WHERE (? IS NULL OR q.topic_id = ?)").get(topic, topic);
     if (topic !== null) details = db.prepare("SELECT q.id AS id, q.text AS text, COUNT(l.short_note_id) AS notes FROM questions q LEFT JOIN question_short_notes l ON l.question_id = q.id WHERE (? IS NULL OR q.topic_id = ?) GROUP BY q.id ORDER BY q.id").all(topic, topic);
   } catch { console.error(`database not found or unreadable: ${path} (run npm run db:seed)`); process.exit(5); }
   if (topic !== null && groups.length === 0) { console.error(`no topic with id ${topic}`); process.exit(4); }
   const cell = (s) => String(s).replace(/\s+/g, " ").replace(/\|/g, "\\|");
   const cut = (s) => { const t = cell(s); return t.length <= 100 ? t : `${t.slice(0, 100)}…`; };
   const out = [`**Статистика** — ${topic === null ? "все категории" : `категория ${topic}`}`, "", "### Сводка по категориям", "| ID категории | Категория | Вопросов | Шортноутов |", "|---|---|---|---|"];
   for (const g of groups) out.push(`| ${g.id} | ${cell(g.name)} | ${g.questions} | ${g.notes} |`);
   out.push(`| | **Итого** | **${total.questions}** | **${total.notes}** |`, "");
   if (topic !== null) {
     out.push("### Детали по вопросам");
     if (details.length === 0) out.push("нет вопросов");
     else {
       const head = groups[0];
       out.push(`| ID вопроса | Вопрос — ${head.id} · ${cell(head.name)} | Шортноутов |`, "|---|---|---|");
       for (const d of details) out.push(`| ${d.id} | ${cut(d.text)} | ${d.notes} |`);
     }
   }
   console.log(out.join("\n"));
   ' -- TOPIC_ID
   ```

   Omit `-- TOPIC_ID` when there is no argument; otherwise replace `TOPIC_ID` with the validated id.
2. Show the script output as it is. Do not recalculate, round, reorder or comment on the numbers. On a non-zero exit code show the stderr message as is; for a missing database suggest `npm run db:seed`.

## Rules

- This is a maintainer tool for inspecting the database. Never use it during a quiz session.
- Counts only. Never read the `options` table, never select `is_correct`, and never say which option is correct. Do not print `explanation` or the text of short notes.
- Do not modify the database or the raw files; only `SELECT`s. All data comes from the DB; do not read `raw-data/`.
- Do not invent or adjust numbers: show only what the script printed.
