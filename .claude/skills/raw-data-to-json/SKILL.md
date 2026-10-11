---
name: raw-data-to-json
description: Convert the raw exam files in raw-data/ (_shortNotes.md, _shortNotesSource.md, described by _shortNotesRelation.md) into JSON files that mirror the tables of src/db/schema.sql (topics, short_notes, questions, options, question_short_notes), the input of `npm run db:seed`. Use when the user asks to convert, export or transform raw data (shortnotes, short-note relations, sources) to JSON. Writes JSON only; it never touches the database. Pipeline: markdown -> /raw-data-to-json -> JSON -> `npm run db:seed` -> DB.
argument-hint: [output-dir]
---

# raw-data-to-json

Turns the markdown files in `raw-data/` into five JSON files that have the same columns and relations as the DB tables, plus a report. It only writes JSON. It is the only code in the project that reads `raw-data/_shortNotes*.md`; `npm run db:seed` and the server do not. `npm run db:seed` reads only these files (`raw-data/json/`), never the markdown, so run this skill again after every edit of `raw-data/*.md`, then follow `import-raw-data`. It does not open or change the SQLite database and does not change any source file.

## Parameter

- `$ARGUMENTS` = optional output directory. Default: `raw-data/json/`. The default lies inside the git-ignored `raw-data/` on purpose: `options.json` contains the answer key (`is_correct`). The output directory must be inside `<project root>/raw-data/` (`..` and symlinks are resolved first). Anything else, including `raw-data/` itself or a path outside it, is refused with `Refusing output directory ...: it must be inside .../raw-data/` before anything is written.

## Procedure

1. Check that `raw-data/_shortNotes.md` and `raw-data/_shortNotesSource.md` exist. If not, tell the user and stop. Skim `raw-data/_shortNotesRelation.md` to confirm the format still matches what the parser expects.
2. Run from the project root (the script `convert.mts` and its parser `parser.ts` are both part of this skill; the parser is used only here, `db:seed` validates and imports the JSON):

   ```bash
   npx tsx .claude/skills/raw-data-to-json/convert.mts [output-dir]
   ```

3. Read the printed summary: counts per file, the schema check line, skipped questions with reasons, number of warnings. The script builds everything in memory, checks it against `schema.sql` in an in-memory database, then writes the set to a scratch directory `raw-data/.json-tmp-<pid>` and validates it with `loadSeedData` from `src/db/seed-json.ts` (the same reader `db:seed` uses, so writer and reader cannot drift apart). Any `SeedDataError` aborts before the output directory is touched; the scratch directory is always removed. Only then are the files written to the output directory, `_report.json` last (the old one is deleted first), so an interrupted run leaves a set without a report, which `db:seed` rejects. An error from this pre-write check (a `SeedDataError` from `loadSeedData`) carries the source number as ` (Q<n>)` when the failing question can be identified (see the catch around `loadSeedData` in `convert.mts`); otherwise the message has no `Qn`. Messages never contain option text or which option is correct.
4. Report to the user: where the files are, the counts, the skipped questions with reasons (open-ended questions without options, missing text or explanation, duplicate option labels, and so on, listed in `_report.json`), and that the files hold the answer key and must not be committed or shown to a quiz client.

## Output files (columns exactly as in `schema.sql`)

| File | Rows |
|---|---|
| `topics.json` | `{ id, name }` |
| `short_notes.json` | `{ id, title, text }`, all parsed notes, also those no question uses |
| `questions.json` | `{ id, topic_id, text, explanation }` |
| `options.json` | `{ id, question_id, position, label, is_correct }`; `is_correct` is the integer `0` or `1`, exactly one `1` per question |
| `question_short_notes.json` | `{ question_id, short_note_id }`, many-to-many, ordered by `question_id` then `short_note_id`; a question can have several notes and a note several questions |
| `_report.json` | `{ counts, skipped: [{ number, reason }], warnings, question_numbers: [{ id, number }] }` (`Qn` numbers and reasons only, nothing about options; `question_numbers` maps every `questions.json` id to its source `Qn`, so that `db:seed` reports `Qn` and not local ids). `_report.json` is **required** by `db:seed`: its `counts` must equal the row counts of the five files, `question_numbers` must cover every question exactly once with unique numbers |

- Ids are `1..n` in source order, so repeated runs give byte-identical files. They are local to this export: `db:seed` matches rows by the natural keys of the schema (`topics.name`, `short_notes.title`, `questions(topic_id, text)`) and never inserts these ids; the database assigns its own.
- If you edit the JSON by hand, renumber ids consistently in all files together (`questions.json`, `options.json`, `question_short_notes.json`, `question_numbers`, `counts`); `db:seed` rejects counts or references that do not match. Option positions must be exactly `1..n` per question and labels unique within a question. Prefer fixing the markdown and converting again.
- Each `skipped[].reason` and warning in `_report.json` is cut to 300 characters (299 plus `…`) to fit the cap of `seed-json.ts`, so a long note title cannot abort the conversion.
- Files are 2-space indented JSON with a trailing newline. Running again overwrites the files in the output directory.
- Before writing, the script inserts all rows into an in-memory database created from `schema.sql` (so CHECK, UNIQUE and foreign key constraints are really exercised) and requires `foreign_key_check` to be clean.

## Rules

- Output only under `raw-data/`: `options.json` holds the answer key. Do not pass another directory or work around the refusal. The script also refuses a dangling symlink on the output path (`Refusing output directory ...: dangling symlink ...`) and any of the six target files being a symlink (`Refusing to write through a symlink: ...`), before writing anything.
- **Never invent content.** A question that cannot be built from the source as written is skipped and listed in the report; no options, answers or explanations are made up. Do not "fix" source wording; report suspicious artifacts instead.
- Never print or paste the contents of `options.json`, and never say which option is correct. Report counts and `Qn` numbers only.
- Do not modify `raw-data/*.md`, `src/` or the database. Do not commit the output.
- If the script fails because the parser interface changed, tell the user; do not work around it by writing a second parser.
