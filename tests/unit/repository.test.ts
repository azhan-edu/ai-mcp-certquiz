import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseError } from "../../src/db/connection.js";
import { importSeedData } from "../../src/db/import.js";
import { createRepository, type Repository } from "../../src/db/repository.js";
import { notesOrderFixture, richFixture, seedData } from "../helpers/seed-json.js";

// TEST DATA ONLY: synthetic fixtures. In richFixture question 1 has options inserted out of
// position order, the correct one in the middle, and notes linked in reverse order.

describe("createRepository", () => {
  let repo: Repository;
  let db: DatabaseSync;

  // DB ids are assigned by the import (not the fixture ids), so look them up by content.
  const idOf = (sql: string, value: string): number =>
    Number((db.prepare(sql).get(value) as { id: number }).id);

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
  });

  it("getShortNotes returns [] for a question without notes", () => {
    expect(
      repo.getShortNotes(idOf("SELECT id FROM questions WHERE text = ?", "TEST question 2?")),
    ).toEqual([]);
  });

  it("getShortNotes returns [] for an unknown question", () => {
    expect(repo.getShortNotes(999)).toEqual([]);
  });
});
