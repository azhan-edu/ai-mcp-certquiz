---
name: import-raw-data
description: Create or update the certsafary SQLite database from the raw exam files in raw-data/ (_shortNotes.md, _shortNotesSource.md, described by _shortNotesRelation.md) in two steps - convert the markdown to raw-data/json/ (raw-data-to-json), then run `npm run db:seed`, which reads only that JSON. Use when the user adds or edits files in raw-data/ or asks to import, sync, load or update questions or short notes from raw data.
---

# import-raw-data

Pipeline: `raw-data/*.md` -> `/raw-data-to-json` -> `raw-data/json/*.json` -> `npm run db:seed` -> DB. `db:seed` reads **only** `raw-data/json/` (never the markdown), so after every edit of the markdown the conversion must be run again, otherwise the seed imports the old JSON. The seed creates the database from `src/db/schema.sql` and adds the questions, options and short notes that are missing. Additive and idempotent: existing rows are never updated or deleted, local JSON ids are never inserted (the DB assigns its own). The logic is committed code:

| File | Role |
|---|---|
| `.claude/skills/raw-data-to-json/convert.mts` | step 1: markdown -> JSON (uses the parser `.claude/skills/raw-data-to-json/parser.ts`, all format rules live there; the only code that reads the markdown) |
| `src/db/seed-json.ts` | `loadSeedData`: zod schemas, cross-file validation, `SeedDataError` |
| `src/db/import.ts` | `importSeedData`: takes only `SeedData` from `loadSeedData`; one transaction, dedup, rollback on error |
| `src/db/connection.ts` | `openDatabase`, `applySchema` |
| `src/db/seed.ts` | CLI behind `npm run db:seed` (`--dry-run`, `--json-dir`) |

## Hard rules

- **Never invent content.** No distractor options, answers, explanations or note text that is not in the raw files. A question that cannot be built from the source as written is skipped by the conversion and reported.
- Do not paraphrase or "fix" source wording. Report suspicious artifacts (e.g. `compu ter-use`, `CLAUDE. md`) to the user instead of correcting them.
- Never print or log which option is correct. Report counts and `Qn` numbers only.
- Do not delete or overwrite the DB file without an explicit request; to start from scratch the user deletes the file and runs `npm run db:seed` again.
- If `raw-data/_shortNotesRelation.md` contradicts the parser, tell the user; if the format changed, update the parser `.claude/skills/raw-data-to-json/parser.ts`, its tests in `tests/skills/raw-data-to-json/`, the `raw-data-to-json` skill and this skill together (use `db-engineer`).

## Procedure

1. Skim `raw-data/_shortNotesRelation.md` and the head of both data files to confirm the format still matches the parser.
2. Step 1, convert: run the `raw-data-to-json` procedure, `npx tsx .claude/skills/raw-data-to-json/convert.mts`. Read its summary: counts per file, skipped questions with reasons, number of warnings. If it fails, stop and tell the user. Never print or open `options.json`.
3. Step 2, dry run: `npm run db:seed -- --dry-run` (the `--` is required so npm passes the flag to the script; `--json-dir <path>` points to another JSON folder, default `raw-data/json`). It writes nothing: no rows, no schema, no DB file. A missing folder or file gives `JSON file ... not found ... Run /raw-data-to-json first.`; an inconsistent file gives a `SeedDataError` naming file, row and rule. Read the report: `parsed`, `inserted` (topics, notes, questions, options, links) vs `already present`, `changed in source` (also a question whose DB holds a note link the source no longer has; changed notes are listed by title), `in database but not in source: N questions (ids ...), M topics (left untouched)` (printed only when non-zero: a hand-edited question text or topic name leaves the old row behind, nothing is deleted), `skipped` with reasons, `warnings` (also `topic <id> has no questions and is not imported`). `_report.json` is required in the JSON folder (missing or with counts that do not match the files: `SeedDataError`).
4. If nothing would be inserted, say so and stop. If the result looks wrong (far fewer questions than expected, many new skip reasons, `db:seed failed: ...`), stop and tell the user instead of importing.
5. Otherwise run the real import: `npm run db:seed` (`DB_PATH` from `.env` or the environment, default `data/certsafary.db`). Run it once more: the second run must report 0 inserted.
6. Verify read-only (replace the path with `DB_PATH`):

   ```bash
   node -e 'const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync(process.env.DB_PATH??"data/certsafary.db",{readOnly:true});const n=(t)=>db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;console.log({topics:n("topics"),notes:n("short_notes"),questions:n("questions"),options:n("options"),links:n("question_short_notes")});console.log("without any option:",db.prepare("SELECT COUNT(*) c FROM questions q WHERE NOT EXISTS (SELECT 1 FROM options o WHERE o.question_id=q.id)").get().c);console.log("without exactly one correct:",db.prepare("SELECT COUNT(*) c FROM questions q WHERE (SELECT COUNT(*) FROM options o WHERE o.question_id=q.id AND o.is_correct=1)<>1").get().c);console.log("fk violations:",db.prepare("PRAGMA foreign_key_check").all().length)'
   ```

   Expect `without any option: 0`, `without exactly one correct: 0` and `fk violations: 0`. Print counts only, never option contents.
7. Report to the user: inserted vs already present per table (links = rows of `question_short_notes`), skipped questions with reasons, items changed in the source (they are **not** applied), and follow-ups (fix source artifacts, add options for open-ended questions, add missing question text).

## What the conversion does (summary)

The parser lives in step 1 (`.claude/skills/raw-data-to-json/parser.ts`, run by `convert.mts`); see the `raw-data-to-json` skill and `raw-data/_shortNotesRelation.md` for details. In short: domains become topics, `### Title` becomes a note, `### Qn` becomes a question with options A, B, C... and the correct one from the answer line, many-to-many note links are resolved by title, explanation comes from the official text or the first own note. A question that cannot be built from the source as written is skipped and listed with its reason. `db:seed` then validates the JSON again (unique ids and natural keys, existing references, at least two options, exactly one correct option per question) and refuses the whole set on any violation.

## Notes

- Links are additive like everything else: missing pairs are inserted (also for questions that already exist), a pair the source no longer has is never deleted, only reported under `changed in source`.
- Dedup key for questions is (topic, text): a fixed typo in a loaded question is inserted as a new row and the old one stays. Tell the user; removing it needs a DB recreate, which only they may request.
- Only seed-like tooling writes to the DB; the MCP server opens it `readOnly`. Restart the server after an import.
- Run `npm run lint`, `npm run typecheck` and `npm test` only if repo files other than this skill were touched.
