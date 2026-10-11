import type { DatabaseSync } from "node:sqlite";
import { applySchema, DatabaseError } from "./connection.js";
import type { SeedData, SeedQuestion } from "./seed-json.js";

/** Counts and ids only: the report must never say which option is correct. */
export interface ImportReport {
  /** `links`: rows added to question_short_notes, also for questions that already existed. */
  inserted: { topics: number; notes: number; questions: number; options: number; links: number };
  existing: { topics: number; notes: number; questions: number };
  /** Already in the DB but different in the source (or with a stale note link); never overwritten. */
  changed: { notes: string[]; questions: number[] };
  /**
   * In the DB but not in the source (typically hand-edited text or topic names). Left untouched.
   * `questions` holds DB question ids. `topics` counts topics in the database that no source
   * question uses (including topics listed in the source without questions).
   */
  notInSource: { questions: number[]; topics: number };
  dryRun: boolean;
}

export interface ImportOptions {
  /** Run everything, then roll back. */
  dryRun?: boolean;
}

type SqlRow = Record<string, unknown> | undefined;

/** Reads a numeric column without asserting the row shape. */
function num(row: SqlRow, column: string): number | undefined {
  const value = row?.[column];
  return typeof value === "number" ? value : undefined;
}

function emptyReport(dryRun: boolean): ImportReport {
  return {
    inserted: { topics: 0, notes: 0, questions: 0, options: 0, links: 0 },
    existing: { topics: 0, notes: 0, questions: 0 },
    changed: { notes: [], questions: [] },
    notInSource: { questions: [], topics: 0 },
    dryRun,
  };
}

/**
 * Additive and idempotent: inserts what is missing, never updates or deletes existing rows.
 * `data` must come from `loadSeedData` (seed-json.ts): that validation is the gate, this function
 * does not re-check the shape of the source.
 */
export function importSeedData(
  db: DatabaseSync,
  data: SeedData,
  options: ImportOptions = {},
): ImportReport {
  const report = emptyReport(options.dryRun ?? false);

  // DDL is transactional in SQLite, so a dry run rolls the schema back too.
  db.exec("BEGIN IMMEDIATE");
  try {
    applySchema(db);

    const findTopic = db.prepare("SELECT id FROM topics WHERE name = ?");
    const insertTopic = db.prepare("INSERT INTO topics (name) VALUES (?)");
    const findNote = db.prepare("SELECT id, text FROM short_notes WHERE title = ?");
    const insertNote = db.prepare("INSERT INTO short_notes (title, text) VALUES (?, ?)");
    const findQuestion = db.prepare(
      "SELECT id, explanation FROM questions WHERE topic_id = ? AND text = ?",
    );
    const insertQuestion = db.prepare(
      "INSERT INTO questions (topic_id, text, explanation) VALUES (?, ?, ?)",
    );
    const insertLink = db.prepare(
      "INSERT OR IGNORE INTO question_short_notes (question_id, short_note_id) VALUES (?, ?)",
    );
    const loadLinks = db.prepare(
      "SELECT short_note_id FROM question_short_notes WHERE question_id = ?",
    );
    const insertOption = db.prepare(
      "INSERT INTO options (id, question_id, position, label, is_correct) VALUES (?, ?, ?, ?, ?)",
    );
    const loadOptions = db.prepare(
      "SELECT position, label, is_correct FROM options WHERE question_id = ? ORDER BY position",
    );
    const countCorrect = db.prepare(
      "SELECT COUNT(*) AS n FROM options WHERE question_id = ? AND is_correct = 1",
    );

    // Option ids are assigned in position order (A, B, C...) so that the id order never reveals
    // the correct option, although the schema requires the correct option to be inserted first.
    let lastOptionId =
      num(db.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM options").get(), "id") ?? 0;

    const topicIds = new Map<string, number>();
    const noteIds = new Map<string, number>();

    const ensureTopic = (name: string): number => {
      const known = topicIds.get(name);
      if (known !== undefined) return known;
      const found = num(findTopic.get(name), "id");
      let id: number;
      if (found !== undefined) {
        id = found;
        report.existing.topics++;
      } else {
        id = Number(insertTopic.run(name).lastInsertRowid);
        report.inserted.topics++;
      }
      topicIds.set(name, id);
      return id;
    };

    const sameAsStored = (question: SeedQuestion, row: SqlRow, questionId: number): boolean => {
      if (row?.explanation !== question.explanation) return false;
      const stored = loadOptions.all(questionId);
      return (
        stored.length === question.options.length &&
        question.options.every((o, i) => {
          const s = stored[i];
          return (
            s?.position === o.position &&
            s.label === o.label &&
            (s.is_correct === 1) === (o.position === question.correctPosition)
          );
        })
      );
    };

    const resolveNoteIds = (question: SeedQuestion): number[] =>
      question.noteTitles.map((title) => {
        const id = noteIds.get(title);
        if (id === undefined)
          throw new DatabaseError(`Q${question.number}: note "${title}" missing`);
        return id;
      });

    /** Adds the missing pairs only; returns true when the DB holds a pair the source dropped. */
    const addLinks = (question: SeedQuestion, questionId: number): boolean => {
      const wanted = resolveNoteIds(question);
      for (const noteId of wanted) {
        if (Number(insertLink.run(questionId, noteId).changes) > 0) report.inserted.links++;
      }
      return loadLinks.all(questionId).some((row) => {
        const id = num(row, "short_note_id");
        return id === undefined || !wanted.includes(id);
      });
    };

    for (const note of data.notes) {
      const row = findNote.get(note.title);
      const noteId = num(row, "id");
      if (noteId !== undefined) {
        noteIds.set(note.title, noteId);
        report.existing.notes++;
        if (row?.text !== note.text) report.changed.notes.push(note.title);
      } else {
        noteIds.set(note.title, Number(insertNote.run(note.title, note.text).lastInsertRowid));
        report.inserted.notes++;
      }
    }

    for (const question of data.questions) {
      const topicId = ensureTopic(question.topic);
      const existing = findQuestion.get(topicId, question.text);
      const existingId = num(existing, "id");
      if (existingId !== undefined) {
        report.existing.questions++;
        const staleLink = addLinks(question, existingId);
        if (staleLink || !sameAsStored(question, existing, existingId)) {
          report.changed.questions.push(question.number);
        }
        continue;
      }

      // Checked first: the database triggers would also refuse it, but with a less useful message.
      const marked = question.options.filter((o) => o.position === question.correctPosition);
      if (marked.length !== 1) {
        throw new DatabaseError(`Q${question.number}: expected exactly one correct option`);
      }

      const questionId = Number(
        insertQuestion.run(topicId, question.text, question.explanation).lastInsertRowid,
      );
      addLinks(question, questionId);
      const firstId = lastOptionId + 1;
      lastOptionId += question.options.length;
      const byPosition = [...question.options].sort((a, b) => a.position - b.position);
      const correct = byPosition.filter((o) => o.position === question.correctPosition);
      const others = byPosition.filter((o) => o.position !== question.correctPosition);
      for (const option of [...correct, ...others]) {
        insertOption.run(
          firstId + byPosition.indexOf(option),
          questionId,
          option.position,
          option.label,
          option.position === question.correctPosition ? 1 : 0,
        );
        report.inserted.options++;
      }
      if (num(countCorrect.get(questionId), "n") !== 1) {
        throw new DatabaseError(`Q${question.number}: expected exactly one correct option`);
      }
      report.inserted.questions++;
    }

    // Read-only: what the DB holds that the source no longer has. Nothing is deleted.
    const sourceTopics = new Set(data.questions.map((q) => q.topic));
    const sourceQuestions = new Set(data.questions.map((q) => `${q.topic}\u0000${q.text}`));
    for (const row of db
      .prepare(
        "SELECT q.id AS id, q.text AS text, t.name AS topic FROM questions q JOIN topics t ON t.id = q.topic_id ORDER BY q.id",
      )
      .all()) {
      const id = num(row, "id");
      if (id !== undefined && !sourceQuestions.has(`${row.topic}\u0000${row.text}`)) {
        report.notInSource.questions.push(id);
      }
    }
    for (const row of db.prepare("SELECT name FROM topics").all()) {
      if (!sourceTopics.has(String(row.name))) report.notInSource.topics++;
    }

    const violations = db.prepare("PRAGMA foreign_key_check").all();
    if (violations.length > 0) throw new DatabaseError("foreign_key_check failed after import");

    db.exec(options.dryRun ? "ROLLBACK" : "COMMIT");
  } catch (err) {
    // SQLite may already have ended the transaction itself; a second ROLLBACK must not mask err.
    try {
      if (db.isTransaction) db.exec("ROLLBACK");
    } catch {
      // keep the original error
    }
    throw err;
  }
  return report;
}
