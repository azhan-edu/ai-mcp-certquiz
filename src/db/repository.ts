import type { DatabaseSync } from "node:sqlite";
import { DatabaseError } from "./connection.js";

export interface Topic {
  id: number;
  name: string;
}

/** An answer option as shown to the client: no correctness flag, by design. */
export interface QuestionOption {
  id: number;
  label: string;
}

/** A question as shown to the client: no topic, explanation or correctness flag, by design. */
export interface Question {
  id: number;
  text: string;
  options: QuestionOption[];
}

export interface ShortNote {
  id: number;
  title: string;
  text: string;
}

export interface Repository {
  getTopic(id: number): Topic | undefined;
  getQuestion(id: number): Question | undefined;
  /** Does not check that the question exists; use `getQuestion` for that. */
  getShortNotes(questionId: number): ShortNote[];
}

function num(value: unknown): number {
  if (typeof value !== "number") throw new DatabaseError("Unexpected column type in the database");
  return value;
}

function str(value: unknown): string {
  if (typeof value !== "string") throw new DatabaseError("Unexpected column type in the database");
  return value;
}

/** Read-only queries for the server; works on a connection opened with `readOnly: true`. */
export function createRepository(db: DatabaseSync): Repository {
  const topicById = db.prepare("SELECT id, name FROM topics WHERE id = ?");
  const questionById = db.prepare("SELECT id, text FROM questions WHERE id = ?");
  const optionsByQuestion = db.prepare(
    "SELECT id, label FROM options WHERE question_id = ? ORDER BY position",
  );
  const notesByQuestion = db.prepare(
    `SELECT n.id, n.title, n.text
     FROM question_short_notes qn
     JOIN short_notes n ON n.id = qn.short_note_id
     WHERE qn.question_id = ?
     ORDER BY n.id`,
  );

  return {
    getTopic(id) {
      const row = topicById.get(id);
      return row ? { id: num(row.id), name: str(row.name) } : undefined;
    },

    getQuestion(id) {
      const row = questionById.get(id);
      if (!row) return undefined;
      const options = optionsByQuestion
        .all(id)
        .map((option) => ({ id: num(option.id), label: str(option.label) }));
      return { id: num(row.id), text: str(row.text), options };
    },

    getShortNotes(questionId) {
      return notesByQuestion
        .all(questionId)
        .map((note) => ({ id: num(note.id), title: str(note.title), text: str(note.text) }));
    },
  };
}
