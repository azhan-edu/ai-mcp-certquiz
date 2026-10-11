import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applySchema } from "../../src/db/connection.js";
import { importSeedData } from "../../src/db/import.js";
import { createRepository, type Repository } from "../../src/db/repository.js";
import { AppError, NotFoundError } from "../../src/lib/errors.js";
import { createQuizService, type QuizService } from "../../src/services/quiz.js";
import { notesOrderFixture, richFixture, seedData } from "../helpers/seed-json.js";

// TEST DATA ONLY: synthetic fixtures, not real exam content.

describe("createQuizService", () => {
  let service: QuizService;
  let db: DatabaseSync;

  // DB ids are assigned by the import (not the fixture ids), so look them up by content.
  const idOf = (sql: string, value: string): number =>
    Number((db.prepare(sql).get(value) as { id: number }).id);
  const q1 = () => idOf("SELECT id FROM questions WHERE text = ?", "TEST question 1?");
  const q2 = () => idOf("SELECT id FROM questions WHERE text = ?", "TEST question 2?");

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    importSeedData(db, seedData(richFixture()));
    service = createQuizService(createRepository(db));
  });

  afterEach(() => {
    db.close();
  });

  it("getTopic returns a known topic", () => {
    const id = idOf("SELECT id FROM topics WHERE name = ?", "Alpha");
    expect(service.getTopic(id)).toEqual({ id, name: "Alpha" });
  });

  it("getTopic throws NotFoundError for an unknown topic", () => {
    expect(() => service.getTopic(999)).toThrow(NotFoundError);
  });

  it("getQuestion returns the question with options in position order", () => {
    const q = service.getQuestion(q1());
    expect(q.id).toBe(q1());
    expect(q.text).toBe("TEST question 1?");
    expect(q.options.map((o) => o.label)).toEqual(["MARKER-1A", "MARKER-1B", "MARKER-1C"]);
  });

  it("getQuestion throws NotFoundError for an unknown question", () => {
    expect(() => service.getQuestion(999)).toThrow(NotFoundError);
  });

  it("question DTO has no correctness marker or explanation, option keys are id and label", () => {
    const q = service.getQuestion(q1());
    expect(JSON.stringify(q)).not.toMatch(/is_?correct|explanation|correctOptionId/i);
    for (const option of q.options) {
      expect(Object.keys(option).sort()).toEqual(["id", "label"]);
    }
  });

  it("listShortNotes returns notes ordered by id", () => {
    const ids = service.listShortNotes(q1()).map((n) => n.id);
    expect(ids).toHaveLength(2);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it("listShortNotes returns full note objects ordered by id, not by title or link order", () => {
    const fresh = new DatabaseSync(":memory:");
    try {
      fresh.exec("PRAGMA foreign_keys = ON");
      importSeedData(fresh, seedData(notesOrderFixture()));
      const noteId = (title: string): number =>
        Number(
          (fresh.prepare("SELECT id FROM short_notes WHERE title = ?").get(title) as { id: number })
            .id,
        );
      const qid = Number((fresh.prepare("SELECT id FROM questions").get() as { id: number }).id);
      expect(createQuizService(createRepository(fresh)).listShortNotes(qid)).toEqual([
        { id: noteId("Zulu note"), title: "Zulu note", text: "Test body of Zulu note." },
        { id: noteId("Alpha note"), title: "Alpha note", text: "Test body of Alpha note." },
        { id: noteId("Mike note"), title: "Mike note", text: "Test body of Mike note." },
      ]);
    } finally {
      fresh.close();
    }
  });

  it("option ids increase with position when the correct option is in the middle", () => {
    const ids = service.getQuestion(q1()).options.map((o) => o.id);
    expect(ids).toHaveLength(3);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it("listShortNotes returns [] for an existing question without notes", () => {
    expect(service.listShortNotes(q2())).toEqual([]);
  });

  it("listShortNotes throws NotFoundError for an unknown question", () => {
    expect(() => service.listShortNotes(999)).toThrow(NotFoundError);
  });

  const optionId = (label: string): number => idOf("SELECT id FROM options WHERE label = ?", label);
  const topicId = (name: string): number => idOf("SELECT id FROM topics WHERE name = ?", name);

  // Runs `fn` against a fresh in-memory DB; `prepare` fills it.
  const withFreshDb = (prepare: (target: DatabaseSync) => void, fn: (s: QuizService) => void) => {
    const fresh = new DatabaseSync(":memory:");
    try {
      fresh.exec("PRAGMA foreign_keys = ON");
      prepare(fresh);
      fn(createQuizService(createRepository(fresh)));
    } finally {
      fresh.close();
    }
  };
  const withEmptyTopic = (target: DatabaseSync): void => {
    importSeedData(target, seedData(richFixture()));
    target.prepare("INSERT INTO topics (name) VALUES (?)").run("Gamma");
  };

  describe("listQuestionIds", () => {
    it("returns ids of all questions in ascending order", () => {
      const ids = service.listQuestionIds();
      expect(ids.length).toBeGreaterThan(0);
      expect(ids).toEqual([...ids].sort((a, b) => a - b));
      for (const id of ids) expect(service.getQuestion(id).id).toBe(id);
    });
  });

  describe("listTopics", () => {
    it("returns topics ordered by id", () => {
      const topics = service.listTopics();
      expect(topics.map((t) => t.name).sort()).toEqual(["Alpha", "Beta"]);
      const ids = topics.map((t) => t.id);
      expect(ids).toEqual([...ids].sort((a, b) => a - b));
    });

    it("includes a topic without questions", () => {
      withFreshDb(withEmptyTopic, (s) => {
        expect(s.listTopics().map((t) => t.name)).toContain("Gamma");
      });
    });
  });

  describe("getRandomQuestion", () => {
    it("returns a known question", () => {
      const known = [q1(), q2()];
      for (let i = 0; i < 10; i++) {
        expect(known).toContain(service.getRandomQuestion().id);
      }
    });

    it("has no correctness keys, explanation or correctOptionId; option keys are id and label", () => {
      for (let i = 0; i < 10; i++) {
        const q = service.getRandomQuestion();
        expect(JSON.stringify(q)).not.toMatch(/is_?correct|explanation|correctOptionId/i);
        expect(q.options.length).toBeGreaterThan(0);
        for (const option of q.options) {
          expect(Object.keys(option).sort()).toEqual(["id", "label"]);
        }
      }
    });

    it("has the same shape as getQuestion for the same id", () => {
      const q = service.getRandomQuestion();
      expect(q).toEqual(service.getQuestion(q.id));
    });

    it("respects the topic filter", () => {
      const beta = topicId("Beta");
      const alpha = topicId("Alpha");
      for (let i = 0; i < 10; i++) {
        expect(service.getRandomQuestion(beta).id).toBe(q1());
        expect(service.getRandomQuestion(alpha).id).toBe(q2());
      }
    });

    it("throws NotFoundError for an unknown topic", () => {
      expect(() => service.getRandomQuestion(999)).toThrow(NotFoundError);
    });

    it("throws NotFoundError for a topic without questions", () => {
      withFreshDb(withEmptyTopic, (s) => {
        const gamma = s.listTopics().find((t) => t.name === "Gamma")?.id;
        expect(gamma).toBeDefined();
        expect(() => s.getRandomQuestion(gamma)).toThrow(NotFoundError);
      });
    });

    it("throws NotFoundError on an empty database", () => {
      withFreshDb(applySchema, (s) => {
        expect(() => s.getRandomQuestion()).toThrow(NotFoundError);
      });
    });
  });

  describe("checkAnswer", () => {
    it("reports the correct option as correct", () => {
      const correct = optionId("MARKER-1B");
      expect(service.checkAnswer(q1(), correct)).toEqual({
        correct: true,
        correctOptionId: correct,
      });
    });

    it("reports each wrong option as incorrect with the same correctOptionId", () => {
      const correct = optionId("MARKER-1B");
      for (const label of ["MARKER-1A", "MARKER-1C"]) {
        expect(service.checkAnswer(q1(), optionId(label))).toEqual({
          correct: false,
          correctOptionId: correct,
        });
      }
    });

    it("does not treat the first or lowest option as the correct one", () => {
      const options = service.getQuestion(q1()).options;
      const lowest = Math.min(...options.map((o) => o.id));
      expect(service.checkAnswer(q1(), lowest).correct).toBe(false);
      expect(service.checkAnswer(q1(), lowest).correctOptionId).not.toBe(lowest);
      const results = options.map((o) => service.checkAnswer(q1(), o.id).correct);
      expect(results.filter(Boolean)).toHaveLength(1);
    });

    it("throws NotFoundError for an option of another question", () => {
      expect(() => service.checkAnswer(q1(), optionId("MARKER-2A"))).toThrow(NotFoundError);
    });

    it("throws NotFoundError for an unknown option", () => {
      expect(() => service.checkAnswer(q1(), 999)).toThrow(NotFoundError);
    });

    it("throws NotFoundError for an unknown question", () => {
      expect(() => service.checkAnswer(999, optionId("MARKER-1A"))).toThrow(NotFoundError);
    });
  });

  describe("getExplanation", () => {
    it("returns the stored explanation text", () => {
      expect(service.getExplanation(q1())).toBe("Explanation 1.");
      expect(service.getExplanation(q2())).toBe("Explanation 2.");
    });

    it("throws NotFoundError for an unknown question", () => {
      expect(() => service.getExplanation(999)).toThrow(NotFoundError);
    });
  });

  describe("getShortNotes", () => {
    it("returns all notes of the question ordered by id", () => {
      const notes = service.getShortNotes(q1());
      expect(notes).toHaveLength(2);
      const ids = notes.map((n) => n.id);
      expect(ids).toEqual([...ids].sort((a, b) => a - b));
      expect(notes).toEqual(service.listShortNotes(q1()));
    });

    it("throws NotFoundError for a question without notes, while listShortNotes returns []", () => {
      expect(() => service.getShortNotes(q2())).toThrow(NotFoundError);
      expect(service.listShortNotes(q2())).toEqual([]);
    });

    it("throws NotFoundError for an unknown question", () => {
      expect(() => service.getShortNotes(999)).toThrow(NotFoundError);
    });
  });

  describe("data integrity", () => {
    // Unreachable through a real DB (schema triggers), so a stub repository is used.
    const stubRepo = (overrides: Partial<Repository>): Repository => ({
      getTopic: () => undefined,
      listTopics: () => [],
      listQuestionIds: () => [],
      getQuestion: () => ({ id: 1, text: "TEST q?", options: [{ id: 10, label: "TEST a" }] }),
      getRandomQuestionId: () => undefined,
      getCorrectOptionId: () => undefined,
      getExplanation: () => undefined,
      getShortNotes: () => [],
      ...overrides,
    });

    it("checkAnswer throws AppError, not NotFoundError, when the question has no correct option", () => {
      const broken = createQuizService(stubRepo({}));
      expect(() => broken.checkAnswer(1, 10)).toThrow(AppError);
      expect(() => broken.checkAnswer(1, 10)).not.toThrow(NotFoundError);
    });

    it("getRandomQuestion names the topic when an existing topic has no questions", () => {
      const noQuestions = createQuizService(
        stubRepo({ getTopic: () => ({ id: 5, name: "TEST" }) }),
      );
      expect(() => noQuestions.getRandomQuestion(5)).toThrow("Topic 5 has no questions");
    });
  });
});
