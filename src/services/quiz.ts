import type { Question, QuestionOption, Repository, ShortNote, Topic } from "../db/repository.js";
import { AppError, NotFoundError } from "../lib/errors.js";

// Public DTOs: no correctness flag, explanation or topic, by design.
export type { Question, QuestionOption, ShortNote, Topic };

/** The only result that reveals which option is correct. */
export interface AnswerResult {
  correct: boolean;
  correctOptionId: number;
}

export interface QuizService {
  getTopic(id: number): Topic;
  listTopics(): Topic[];
  getQuestion(id: number): Question;
  /** A random question, optionally from one topic. Unknown topic or no questions throw `NotFoundError`. */
  getRandomQuestion(topicId?: number): Question;
  /** The only method that reveals the correct option. */
  checkAnswer(questionId: number, optionId: number): AnswerResult;
  getExplanation(questionId: number): string;
  /** Resource view: `[]` for a question without notes. */
  getShortNotes(questionId: number): ShortNote[];
  /** Tool view: all notes of the question; none throws `NotFoundError`. */
  getShortNote(questionId: number): ShortNote[];
}

/**
 * Quiz queries for MCP tools and resources. Ids are expected to be validated
 * (positive integers) by the caller; unknown ids throw `NotFoundError`.
 */
export function createQuizService(repo: Repository): QuizService {
  function requireQuestion(id: number): Question {
    const question = repo.getQuestion(id);
    if (!question) throw new NotFoundError(`Question ${id} not found`);
    return question;
  }

  function getShortNotes(questionId: number): ShortNote[] {
    requireQuestion(questionId);
    return repo.getShortNotes(questionId);
  }

  return {
    getTopic(id) {
      const topic = repo.getTopic(id);
      if (!topic) throw new NotFoundError(`Topic ${id} not found`);
      return topic;
    },

    listTopics() {
      return repo.listTopics();
    },

    getQuestion: requireQuestion,

    getRandomQuestion(topicId) {
      if (topicId !== undefined && !repo.getTopic(topicId)) {
        throw new NotFoundError(`Topic ${topicId} not found`);
      }
      const id = repo.getRandomQuestionId(topicId);
      if (id === undefined) {
        throw new NotFoundError(
          topicId === undefined ? "No questions available" : `Topic ${topicId} has no questions`,
        );
      }
      return requireQuestion(id);
    },

    checkAnswer(questionId, optionId) {
      const question = requireQuestion(questionId);
      if (!question.options.some((option) => option.id === optionId)) {
        throw new NotFoundError(`Option ${optionId} not found for question ${questionId}`);
      }
      const correctOptionId = repo.getCorrectOptionId(questionId);
      if (correctOptionId === undefined) {
        throw new AppError(`Question ${questionId} has no correct option`);
      }
      return { correct: optionId === correctOptionId, correctOptionId };
    },

    getExplanation(questionId) {
      requireQuestion(questionId);
      const explanation = repo.getExplanation(questionId);
      if (explanation === undefined) throw new NotFoundError(`Question ${questionId} not found`);
      return explanation;
    },

    getShortNotes,

    getShortNote(questionId) {
      const notes = getShortNotes(questionId);
      if (notes.length === 0) throw new NotFoundError(`Question ${questionId} has no short notes`);
      return notes;
    },
  };
}
