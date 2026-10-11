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
  /** A random question id, optionally within one topic; undefined when there is none. */
  getRandomQuestionId(topicId?: number): number | undefined;
  /**
   * The only server read of `is_correct`; used only by `checkAnswer`. Never expose the result
   * through a question DTO, tool or resource other than as the outcome of a check.
   */
  getCorrectOptionId(questionId: number): number | undefined;
  /** The stored explanation of a question; undefined when the question does not exist. */
  getExplanation(questionId: number): string | undefined;
  listTopics(): Topic[];
  /** Ids of all questions in ascending order; ids only, no question data. */
  listQuestionIds(): number[];
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
  // ORDER BY RANDOM() is intentional: the questions table is small, so a full scan and sort per call is acceptable.
  const randomQuestionId = db.prepare("SELECT id FROM questions ORDER BY RANDOM() LIMIT 1");
  const randomQuestionIdInTopic = db.prepare(
    "SELECT id FROM questions WHERE topic_id = ? ORDER BY RANDOM() LIMIT 1",
  );
  const correctOptionId = db.prepare(
    "SELECT id FROM options WHERE question_id = ? AND is_correct = 1",
  );
  const explanationById = db.prepare("SELECT explanation FROM questions WHERE id = ?");
  const allTopics = db.prepare("SELECT id, name FROM topics ORDER BY id");
  const allQuestionIds = db.prepare("SELECT id FROM questions ORDER BY id");

  return {
    getRandomQuestionId(topicId) {
      const row =
        topicId === undefined ? randomQuestionId.get() : randomQuestionIdInTopic.get(topicId);
      return row ? num(row.id) : undefined;
    },

    getCorrectOptionId(questionId) {
      const row = correctOptionId.get(questionId);
      return row ? num(row.id) : undefined;
    },

    getExplanation(questionId) {
      const row = explanationById.get(questionId);
      return row ? str(row.explanation) : undefined;
    },

    listTopics() {
      return allTopics.all().map((row) => ({ id: num(row.id), name: str(row.name) }));
    },

    listQuestionIds() {
      return allQuestionIds.all().map((row) => num(row.id));
    },

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
