import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applySchema, DatabaseError, openDatabase } from "../../src/db/connection.js";
import { importSeedData } from "../../src/db/import.js";
import { formatReport } from "../../src/db/report.js";
import { seedDatabase } from "../../src/db/run-seed.js";
import type { SeedData } from "../../src/db/seed-json.js";
import {
  buildFixture,
  loaded,
  minimalFixture,
  seedData,
  writeFixture,
} from "../helpers/seed-json.js";

// TEST DATA ONLY: synthetic JSON fixtures, not real exam content. SeedData comes only from
// loadSeedData (via the fixture helpers). Option labels are unique MARKER strings.

function count(db: DatabaseSync, table: string): number {
  return Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n);
}

function pairs(db: DatabaseSync): string[] {
  return db
    .prepare(
      "SELECT q.text AS q, n.title AS n FROM question_short_notes l JOIN questions q ON q.id = l.question_id JOIN short_notes n ON n.id = l.short_note_id ORDER BY q.text, n.title",
    )
    .all()
    .map((r) => `${String(r.q)} -> ${String(r.n)}`);
}

function memoryDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

describe("importSeedData: question_short_notes", () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = memoryDb();
  });

  /** `notes` lists every note title of the set; each question names the titles it links to. */
  const parse = (notes: string[], questions: { notes: string[] }[]) =>
    seedData(buildFixture({ notes, questions }));

  it("a new question with two notes inserts two links; a second run inserts none", () => {
    const data = parse(["Note A", "Note B"], [{ notes: ["Note A", "Note B"] }]);
    const first = importSeedData(db, data);
    expect(first.inserted.links).toBe(2);
    expect(pairs(db)).toEqual(["TEST question 1? -> Note A", "TEST question 1? -> Note B"]);
    const again = importSeedData(db, data);
    expect(again.inserted).toEqual({ topics: 0, notes: 0, questions: 0, options: 0, links: 0 });
    expect(again.changed).toEqual({ notes: [], questions: [] });
    expect(count(db, "question_short_notes")).toBe(2);
  });

  it("adds a new source pair to an existing question without flagging it as changed", () => {
    importSeedData(db, parse(["Note A", "Note B"], [{ notes: ["Note A"] }]));
    const grown = parse(["Note A", "Note B"], [{ notes: ["Note A", "Note B"] }]);
    const report = importSeedData(db, grown);
    expect(report.inserted.links).toBe(1);
    expect(report.inserted.questions).toBe(0);
    expect(report.changed.questions).toEqual([]);
    expect(pairs(db)).toEqual(["TEST question 1? -> Note A", "TEST question 1? -> Note B"]);
  });

  it("a stored pair the source dropped is reported as changed and never deleted", () => {
    importSeedData(db, parse(["Note A", "Note B"], [{ notes: ["Note A", "Note B"] }]));
    const shrunk = parse(["Note A", "Note B"], [{ notes: ["Note A"] }]);
    const report = importSeedData(db, shrunk);
    expect(report.changed.questions).toEqual([1]);
    expect(report.inserted.links).toBe(0);
    expect(pairs(db)).toEqual(["TEST question 1? -> Note A", "TEST question 1? -> Note B"]);
  });

  it("one note shared by two questions is stored once and linked twice", () => {
    const data = parse(["Note A"], [{ notes: ["Note A"] }, { notes: ["Note A"] }]);
    const report = importSeedData(db, data);
    expect(report.inserted.notes).toBe(1);
    expect(report.inserted.links).toBe(2);
    expect(count(db, "short_notes")).toBe(1);
    expect(pairs(db)).toEqual(["TEST question 1? -> Note A", "TEST question 2? -> Note A"]);
  });

  it("a question without notes gets no link rows", () => {
    const report = importSeedData(db, parse(["Note A"], [{ notes: [] }]));
    expect(report.inserted.questions).toBe(1);
    expect(report.inserted.links).toBe(0);
    expect(count(db, "question_short_notes")).toBe(0);
  });

  it("rolls back the link rows when a later check fails", () => {
    importSeedData(db, parse([], []));
    const data = parse(["Note A", "Note B"], [{ notes: ["Note A", "Note B"] }]);
    const broken: SeedData = {
      ...data,
      questions: data.questions.map((q) => ({ ...q, correctPosition: 99 })),
    };
    expect(() => importSeedData(db, broken)).toThrow(/exactly one correct option/);
    expect(count(db, "question_short_notes")).toBe(0);
    expect(count(db, "questions")).toBe(0);
    expect(count(db, "short_notes")).toBe(0);
  });

  it("a dry run leaves no link rows", () => {
    importSeedData(db, parse([], []));
    const data = parse(["Note A"], [{ notes: ["Note A"] }]);
    const report = importSeedData(db, data, { dryRun: true });
    expect(report.inserted.links).toBe(1);
    expect(count(db, "question_short_notes")).toBe(0);
  });

  it("a dry run adds no missing pair to an existing question", () => {
    importSeedData(db, parse(["Note A", "Note B"], [{ notes: ["Note A"] }]));
    const grown = parse(["Note A", "Note B"], [{ notes: ["Note A", "Note B"] }]);
    const report = importSeedData(db, grown, { dryRun: true });
    expect(report.inserted.links).toBe(1);
    expect(count(db, "question_short_notes")).toBe(1);
  });

  it("leaves foreign_key_check empty after an import", () => {
    importSeedData(
      db,
      parse(["Note A", "Note B"], [{ notes: ["Note A"] }, { notes: ["Note A", "Note B"] }]),
    );
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  describe("schema constraints", () => {
    beforeEach(() => {
      importSeedData(
        db,
        parse(["Note A", "Note B"], [{ notes: ["Note A", "Note B"] }, { notes: ["Note A"] }]),
      );
    });

    it("deleting a question removes its links and keeps the notes", () => {
      db.exec("DELETE FROM questions WHERE text = 'TEST question 1?'");
      expect(pairs(db)).toEqual(["TEST question 2? -> Note A"]);
      expect(count(db, "short_notes")).toBe(2);
    });

    it("deleting a note removes its links and keeps the questions", () => {
      db.exec("DELETE FROM short_notes WHERE title = 'Note A'");
      expect(pairs(db)).toEqual(["TEST question 1? -> Note B"]);
      expect(count(db, "questions")).toBe(2);
    });

    it("the primary key rejects a duplicate pair", () => {
      expect(() =>
        db.exec(
          "INSERT INTO question_short_notes (question_id, short_note_id) SELECT question_id, short_note_id FROM question_short_notes LIMIT 1",
        ),
      ).toThrow(/constraint/i);
    });

    it("rejects a link to a missing question or note", () => {
      expect(() =>
        db.exec("INSERT INTO question_short_notes (question_id, short_note_id) VALUES (9999, 1)"),
      ).toThrow(/constraint/i);
    });
  });
});

describe("formatReport: links", () => {
  const twoNotes = ["Note A", "Note B"];

  it("prints the link count and leaks no option label or is_correct", () => {
    const { data, summary } = loaded(
      buildFixture({ notes: twoNotes, questions: [{ notes: twoNotes }] }),
    );
    const db = memoryDb();
    const output = formatReport(importSeedData(db, data), summary, "test.db");
    expect(output).toContain("2 links");
    expect(output).not.toMatch(/MARKER/);
    expect(output).not.toMatch(/is_?correct/i);
  });

  it("names a question with a stale link as changed, still without leaking", () => {
    const db = memoryDb();
    importSeedData(
      db,
      seedData(buildFixture({ notes: twoNotes, questions: [{ notes: twoNotes }] })),
    );
    const shrunk = loaded(buildFixture({ notes: twoNotes, questions: [{ notes: ["Note A"] }] }));
    const output = formatReport(importSeedData(db, shrunk.data), shrunk.summary, "test.db");
    expect(output).toContain("0 links");
    expect(output).toContain("Q1");
    expect(output).not.toMatch(/MARKER|is_?correct/i);
  });
});

describe("database files", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "certsafary-dbfiles-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("read-only open of a database missing question_short_notes throws the no-schema error", () => {
    const current = join(dir, "current.db");
    const db = new DatabaseSync(current);
    applySchema(db);
    db.exec("DROP TABLE question_short_notes");
    db.close();
    expect(() => openDatabase(current, { readOnly: true })).toThrow(DatabaseError);
    expect(() => openDatabase(current, { readOnly: true })).toThrow(/no schema.*db:seed/);
  });

  it("read-only open of a complete database works", () => {
    const current = join(dir, "current.db");
    const db = new DatabaseSync(current);
    applySchema(db);
    db.close();
    const reader = openDatabase(current, { readOnly: true });
    expect(count(reader, "question_short_notes")).toBe(0);
    reader.close();
  });

  it("an empty file still goes through the normal flow: seed applies the schema", () => {
    const empty = join(dir, "empty.db");
    writeFileSync(empty, "");
    const jsonDir = join(dir, "json");
    writeFixture(jsonDir, minimalFixture());
    expect(seedDatabase({ dbPath: empty, jsonDir, dryRun: false })).toContain("inserted: 1 topics");
    const reader = openDatabase(empty, { readOnly: true });
    expect(count(reader, "questions")).toBe(1);
    expect(count(reader, "question_short_notes")).toBe(1);
    reader.close();
  });

  it("a non-SQLite text file read-only throws a not-a-SQLite-database error", () => {
    const text = join(dir, "text.db");
    writeFileSync(text, "this is not a database, just text padding ".repeat(50));
    expect(() => openDatabase(text, { readOnly: true })).toThrow(DatabaseError);
    expect(() => openDatabase(text, { readOnly: true })).toThrow(/not a SQLite database.*db:seed/);
  });
});
