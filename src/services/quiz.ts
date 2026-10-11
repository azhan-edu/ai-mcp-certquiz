import type { Question, QuestionOption, Repository, ShortNote, Topic } from "../db/repository.js";
import { NotFoundError } from "../lib/errors.js";

// Public DTOs: no correctness flag, explanation or topic, by design.
export type { Question, QuestionOption, ShortNote, Topic };

export interface QuizService {
  getTopic(id: number): Topic;
  getQuestion(id: number): Question;
  getShortNotes(questionId: number): ShortNote[];
}

/**
 * Read-only quiz queries for MCP resources. Ids are expected to be validated
 * (positive integers) by the caller; unknown ids throw `NotFoundError`.
 */
export function createQuizService(repo: Repository): QuizService {
  function requireQuestion(id: number): Question {
    const question = repo.getQuestion(id);
    if (!question) throw new NotFoundError(`Question ${id} not found`);
    return question;
  }

  return {
    getTopic(id) {
      const topic = repo.getTopic(id);
      if (!topic) throw new NotFoundError(`Topic ${id} not found`);
      return topic;
    },

    getQuestion: requireQuestion,

    getShortNotes(questionId) {
      requireQuestion(questionId);
      return repo.getShortNotes(questionId);
    },
  };
}
