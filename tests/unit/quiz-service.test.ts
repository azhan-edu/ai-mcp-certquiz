import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importSeedData } from "../../src/db/import.js";
import { createRepository } from "../../src/db/repository.js";
import { NotFoundError } from "../../src/lib/errors.js";
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

  it("getShortNotes returns notes ordered by id", () => {
    const ids = service.getShortNotes(q1()).map((n) => n.id);
    expect(ids).toHaveLength(2);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it("getShortNotes returns full note objects ordered by id, not by title or link order", () => {
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
      expect(createQuizService(createRepository(fresh)).getShortNotes(qid)).toEqual([
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

  it("getShortNotes returns [] for an existing question without notes", () => {
    expect(service.getShortNotes(q2())).toEqual([]);
  });

  it("getShortNotes throws NotFoundError for an unknown question", () => {
    expect(() => service.getShortNotes(999)).toThrow(NotFoundError);
  });
});
