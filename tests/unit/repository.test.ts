import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applySchema, DatabaseError } from "../../src/db/connection.js";
import { importSeedData } from "../../src/db/import.js";
import { createRepository, type Repository } from "../../src/db/repository.js";
import { buildFixture, notesOrderFixture, richFixture, seedData } from "../helpers/seed-json.js";

// TEST DATA ONLY: synthetic fixtures. In richFixture question 1 has options inserted out of
// position order, the correct one in the middle, and notes linked in reverse order.

describe("createRepository", () => {
  let repo: Repository;
  let db: DatabaseSync;

  // DB ids are assigned by the import (not the fixture ids), so look them up by content.
  const idOf = (sql: string, value: string): number =>
    Number((db.prepare(sql).get(value) as { id: number }).id);

  // The import creates topics only for source questions, so add a topic without questions by hand.
  const importWithEmptyTopic = (target: DatabaseSync): void => {
    importSeedData(target, seedData(richFixture()));
    target.prepare("INSERT INTO topics (name) VALUES (?)").run("Gamma");
  };

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    importSeedData(db, seedData(richFixture()));
    repo = createRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it("getTopic returns a known topic", () => {
    const id = idOf("SELECT id FROM topics WHERE name = ?", "Beta");
    expect(repo.getTopic(id)).toEqual({ id, name: "Beta" });
  });

  it("getTopic returns undefined for an unknown id", () => {
    expect(repo.getTopic(999)).toBeUndefined();
  });

  it("getQuestion returns id, text and options with only id and label", () => {
    const id = idOf("SELECT id FROM questions WHERE text = ?", "TEST question 2?");
    const q = repo.getQuestion(id);
    expect(q?.id).toBe(id);
    expect(q?.text).toBe("TEST question 2?");
    expect(q?.options.map((o) => o.label)).toEqual(["MARKER-2A", "MARKER-2B"]);
    for (const o of q?.options ?? []) expect(Object.keys(o).sort()).toEqual(["id", "label"]);
  });

  it("getQuestion returns undefined for an unknown id", () => {
    expect(repo.getQuestion(999)).toBeUndefined();
  });

  it("orders options by position, not by id or correctness", () => {
    const q = repo.getQuestion(idOf("SELECT id FROM questions WHERE text = ?", "TEST question 1?"));
    expect(q?.options.map((o) => o.label)).toEqual(["MARKER-1A", "MARKER-1B", "MARKER-1C"]);
  });

  it("question DTO does not leak correctness, explanation or topic", () => {
    for (const text of ["TEST question 1?", "TEST question 2?"]) {
      const q = repo.getQuestion(idOf("SELECT id FROM questions WHERE text = ?", text));
      expect(JSON.stringify(q)).not.toMatch(/is_?correct|explanation|correctOptionId/i);
      expect(Object.keys(q ?? {}).sort()).toEqual(["id", "options", "text"]);
      for (const option of q?.options ?? []) {
        expect(Object.keys(option).sort()).toEqual(["id", "label"]);
      }
    }
  });

  it("getShortNotes returns notes ordered by id, not by title or link order", () => {
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
      expect(noteId("Zulu note")).toBeLessThan(noteId("Alpha note"));
      expect(noteId("Alpha note")).toBeLessThan(noteId("Mike note"));
      expect(createRepository(fresh).getShortNotes(qid)).toEqual([
        { id: noteId("Zulu note"), title: "Zulu note", text: "Test body of Zulu note." },
        { id: noteId("Alpha note"), title: "Alpha note", text: "Test body of Alpha note." },
        { id: noteId("Mike note"), title: "Mike note", text: "Test body of Mike note." },
      ]);
    } finally {
      fresh.close();
    }
  });

  it("getShortNotes returns full note objects", () => {
    const notes = repo.getShortNotes(
      idOf("SELECT id FROM questions WHERE text = ?", "TEST question 1?"),
    );
    expect(notes).toEqual([
      {
        id: idOf("SELECT id FROM short_notes WHERE title = ?", "Note one"),
        title: "Note one",
        text: "Test note one.",
      },
      {
        id: idOf("SELECT id FROM short_notes WHERE title = ?", "Note two"),
        title: "Note two",
        text: "Test note two.",
      },
    ]);
  });

  it("option ids increase with position even when the correct option is in the middle", () => {
    const qid = idOf("SELECT id FROM questions WHERE text = ?", "TEST question 1?");
    const correct = db
      .prepare("SELECT position FROM options WHERE question_id = ? AND is_correct = 1")
      .get(qid) as { position: number };
    expect(Number(correct.position)).toBe(2);
    const options = repo.getQuestion(qid)?.options ?? [];
    expect(options.map((o) => o.label)).toEqual(["MARKER-1A", "MARKER-1B", "MARKER-1C"]);
    const ids = options.map((o) => o.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(new Set(ids).size).toBe(ids.length);
  });

  describe("column type guards", () => {
    const stubDb = (row: Record<string, unknown>): DatabaseSync =>
      ({
        prepare: () => ({ get: () => row, all: () => [row] }),
      }) as unknown as DatabaseSync;

    it("getTopic throws DatabaseError on a non-number id", () => {
      expect(() => createRepository(stubDb({ id: "1", name: "x" })).getTopic(1)).toThrow(
        DatabaseError,
      );
    });

    it("getTopic throws DatabaseError on a non-string name", () => {
      expect(() => createRepository(stubDb({ id: 1, name: 5 })).getTopic(1)).toThrow(DatabaseError);
    });

    it("getShortNotes throws DatabaseError on a non-string title", () => {
      expect(() =>
        createRepository(stubDb({ id: 1, title: null, text: "t" })).getShortNotes(1),
      ).toThrow(DatabaseError);
    });

    it("getQuestion throws DatabaseError on a non-string option label", () => {
      expect(() => createRepository(stubDb({ id: 1, text: "q", label: 7 })).getQuestion(1)).toThrow(
        DatabaseError,
      );
    });

    it("getRandomQuestionId throws DatabaseError on a non-number id", () => {
      expect(() => createRepository(stubDb({ id: "1" })).getRandomQuestionId()).toThrow(
        DatabaseError,
      );
      expect(() => createRepository(stubDb({ id: "1" })).getRandomQuestionId(1)).toThrow(
        DatabaseError,
      );
    });

    it("getCorrectOptionId throws DatabaseError on a non-number id", () => {
      expect(() => createRepository(stubDb({ id: "1" })).getCorrectOptionId(1)).toThrow(
        DatabaseError,
      );
    });

    it("getExplanation throws DatabaseError on a non-string explanation", () => {
      expect(() => createRepository(stubDb({ explanation: 5 })).getExplanation(1)).toThrow(
        DatabaseError,
      );
    });

    it("listTopics throws DatabaseError on a non-number id or non-string name", () => {
      expect(() => createRepository(stubDb({ id: "1", name: "x" })).listTopics()).toThrow(
        DatabaseError,
      );
      expect(() => createRepository(stubDb({ id: 1, name: 5 })).listTopics()).toThrow(
        DatabaseError,
      );
    });
  });

  describe("on a seeded temp file opened read-only", () => {
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "certquiz-repo-test-"));
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it("serves the new read methods", () => {
      const path = join(dir, "test.db");
      const writer = new DatabaseSync(path);
      try {
        writer.exec("PRAGMA foreign_keys = ON");
        importSeedData(writer, seedData(richFixture()));
      } finally {
        writer.close();
      }

      const ro = new DatabaseSync(path, { readOnly: true });
      try {
        const roRepo = createRepository(ro);
        const q1 = Number(
          (
            ro.prepare("SELECT id FROM questions WHERE text = ?").get("TEST question 1?") as {
              id: number;
            }
          ).id,
        );
        const correct = Number(
          (ro.prepare("SELECT id FROM options WHERE label = ?").get("MARKER-1B") as { id: number })
            .id,
        );
        const known = new Set(
          ro
            .prepare("SELECT id FROM questions")
            .all()
            .map((r) => Number(r.id)),
        );
        const random = roRepo.getRandomQuestionId();
        expect(random !== undefined && known.has(random)).toBe(true);
        expect(roRepo.getCorrectOptionId(q1)).toBe(correct);
        expect(roRepo.getExplanation(q1)).toBe("Explanation 1.");
        expect(roRepo.listTopics().map((t) => t.name)).toEqual(["Beta", "Alpha"]);
      } finally {
        ro.close();
      }
    });
  });

  it("getShortNotes returns [] for a question without notes", () => {
    expect(
      repo.getShortNotes(idOf("SELECT id FROM questions WHERE text = ?", "TEST question 2?")),
    ).toEqual([]);
  });

  it("getShortNotes returns [] for an unknown question", () => {
    expect(repo.getShortNotes(999)).toEqual([]);
  });

  describe("getRandomQuestionId", () => {
    it("returns an id from the known set", () => {
      const known = new Set([
        idOf("SELECT id FROM questions WHERE text = ?", "TEST question 1?"),
        idOf("SELECT id FROM questions WHERE text = ?", "TEST question 2?"),
      ]);
      for (let i = 0; i < 20; i++) {
        const id = repo.getRandomQuestionId();
        expect(id !== undefined && known.has(id)).toBe(true);
      }
    });

    it("returns only an id (a number)", () => {
      expect(typeof repo.getRandomQuestionId()).toBe("number");
    });

    it("respects the topic filter and always returns the only question of a topic", () => {
      // richFixture: Beta has only question 1, Alpha has only question 2.
      const beta = idOf("SELECT id FROM topics WHERE name = ?", "Beta");
      const alpha = idOf("SELECT id FROM topics WHERE name = ?", "Alpha");
      const q1 = idOf("SELECT id FROM questions WHERE text = ?", "TEST question 1?");
      const q2 = idOf("SELECT id FROM questions WHERE text = ?", "TEST question 2?");
      for (let i = 0; i < 20; i++) {
        expect(repo.getRandomQuestionId(beta)).toBe(q1);
        expect(repo.getRandomQuestionId(alpha)).toBe(q2);
      }
    });

    it("stays inside a topic that has several questions", () => {
      const fresh = new DatabaseSync(":memory:");
      try {
        fresh.exec("PRAGMA foreign_keys = ON");
        importSeedData(
          fresh,
          seedData(
            buildFixture({
              questions: [
                { topic: "Alpha" },
                { topic: "Alpha" },
                { topic: "Alpha" },
                { topic: "Beta", text: "TEST beta question?" },
              ],
            }),
          ),
        );
        const alpha = Number(
          (fresh.prepare("SELECT id FROM topics WHERE name = 'Alpha'").get() as { id: number }).id,
        );
        const inAlpha = new Set(
          fresh
            .prepare("SELECT id FROM questions WHERE topic_id = ?")
            .all(alpha)
            .map((r) => Number(r.id)),
        );
        expect(inAlpha.size).toBe(3);
        const freshRepo = createRepository(fresh);
        for (let i = 0; i < 30; i++) {
          const id = freshRepo.getRandomQuestionId(alpha);
          expect(id !== undefined && inAlpha.has(id)).toBe(true);
        }
      } finally {
        fresh.close();
      }
    });

    it("returns undefined for a topic without questions or an unknown topic", () => {
      const fresh = new DatabaseSync(":memory:");
      try {
        fresh.exec("PRAGMA foreign_keys = ON");
        importWithEmptyTopic(fresh);
        const gamma = Number(
          (fresh.prepare("SELECT id FROM topics WHERE name = 'Gamma'").get() as { id: number }).id,
        );
        const freshRepo = createRepository(fresh);
        expect(freshRepo.getRandomQuestionId(gamma)).toBeUndefined();
        expect(freshRepo.getRandomQuestionId(999)).toBeUndefined();
      } finally {
        fresh.close();
      }
    });

    it("returns undefined on an empty database", () => {
      const empty = new DatabaseSync(":memory:");
      try {
        empty.exec("PRAGMA foreign_keys = ON");
        applySchema(empty);
        const emptyRepo = createRepository(empty);
        expect(emptyRepo.getRandomQuestionId()).toBeUndefined();
        expect(emptyRepo.getRandomQuestionId(1)).toBeUndefined();
      } finally {
        empty.close();
      }
    });
  });

  describe("getCorrectOptionId", () => {
    it("matches the fixture's correct option", () => {
      const q1 = idOf("SELECT id FROM questions WHERE text = ?", "TEST question 1?");
      const q2 = idOf("SELECT id FROM questions WHERE text = ?", "TEST question 2?");
      const optionId = (label: string): number =>
        idOf("SELECT id FROM options WHERE label = ?", label);
      expect(repo.getCorrectOptionId(q1)).toBe(optionId("MARKER-1B"));
      expect(repo.getCorrectOptionId(q2)).toBe(optionId("MARKER-2A"));
    });

    it("returns undefined for an unknown question", () => {
      expect(repo.getCorrectOptionId(999)).toBeUndefined();
    });
  });

  describe("getExplanation", () => {
    it("returns the stored explanation text", () => {
      const q1 = idOf("SELECT id FROM questions WHERE text = ?", "TEST question 1?");
      const q2 = idOf("SELECT id FROM questions WHERE text = ?", "TEST question 2?");
      expect(repo.getExplanation(q1)).toBe("Explanation 1.");
      expect(repo.getExplanation(q2)).toBe("Explanation 2.");
    });

    it("returns undefined for an unknown question", () => {
      expect(repo.getExplanation(999)).toBeUndefined();
    });
  });

  describe("listTopics", () => {
    it("returns topics ordered by id, including one without questions", () => {
      const fresh = new DatabaseSync(":memory:");
      try {
        fresh.exec("PRAGMA foreign_keys = ON");
        importWithEmptyTopic(fresh);
        const topics = createRepository(fresh).listTopics();
        expect(topics.map((t) => t.name)).toEqual(["Beta", "Alpha", "Gamma"]);
        const ids = topics.map((t) => t.id);
        expect(ids).toEqual([...ids].sort((a, b) => a - b));
        for (const topic of topics) expect(Object.keys(topic).sort()).toEqual(["id", "name"]);
      } finally {
        fresh.close();
      }
    });

    it("returns [] on an empty database", () => {
      const empty = new DatabaseSync(":memory:");
      try {
        applySchema(empty);
        expect(createRepository(empty).listTopics()).toEqual([]);
      } finally {
        empty.close();
      }
    });
  });
});
