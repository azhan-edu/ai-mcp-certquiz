import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedDatabase } from "../../src/db/run-seed.js";
import {
  type Fixture,
  minimalFixture,
  richFixture,
  sourceNumber,
  writeFixture,
} from "../helpers/seed-json.js";

// TEST DATA ONLY: synthetic fixtures, not real exam content.

describe("seedDatabase", () => {
  let dir: string;
  let jsonDir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "certsafary-seed-"));
    jsonDir = join(dir, "json");
    dbPath = join(dir, "db", "test.db");
    writeFixture(jsonDir, minimalFixture());
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const questions = (): number => {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      return Number(db.prepare("SELECT COUNT(*) AS n FROM questions").get()?.n);
    } finally {
      db.close();
    }
  };

  it("a dry run on a missing database creates no file and no directory", () => {
    const report = seedDatabase({ dbPath, jsonDir, dryRun: true });
    expect(report).toContain("DRY RUN");
    expect(report).toContain("1 questions");
    expect(existsSync(dbPath)).toBe(false);
    expect(existsSync(join(dir, "db"))).toBe(false);
  });

  it("creates the database, and a second run inserts nothing", () => {
    expect(seedDatabase({ dbPath, jsonDir, dryRun: false })).toContain("inserted: 1 topics");
    expect(questions()).toBe(1);
    expect(seedDatabase({ dbPath, jsonDir, dryRun: false })).toContain("inserted: 0 topics");
    expect(questions()).toBe(1);
  });

  it("a dry run on an existing database writes nothing", () => {
    seedDatabase({ dbPath, jsonDir, dryRun: false });
    const grown = minimalFixture();
    grown.questions.push({
      id: 2,
      topic_id: 1,
      text: "TEST other?",
      explanation: "Test explanation 2.",
    });
    grown.options.push(
      { id: 3, question_id: 2, position: 1, label: "MARKER-WRONG-2", is_correct: 0 },
      { id: 4, question_id: 2, position: 2, label: "MARKER-RIGHT-2", is_correct: 1 },
    );
    writeFixture(jsonDir, grown);
    const report = seedDatabase({ dbPath, jsonDir, dryRun: true });
    expect(report).toContain("inserted: 0 topics, 0 notes, 1 questions");
    expect(questions()).toBe(1);
  });

  it("a missing JSON file fails before any database file or directory is created", () => {
    rmSync(join(jsonDir, "short_notes.json"));
    expect(() => seedDatabase({ dbPath, jsonDir, dryRun: false })).toThrow(
      /short_notes\.json not found.* Run \/raw-data-to-json first\./,
    );
    expect(existsSync(dbPath)).toBe(false);
    expect(existsSync(join(dir, "db"))).toBe(false);
  });

  it("a missing JSON directory fails before any database file or directory is created", () => {
    const missing = join(dir, "no-such-json");
    expect(() => seedDatabase({ dbPath, jsonDir: missing, dryRun: false })).toThrow(
      /not found\. Run \/raw-data-to-json first\./,
    );
    expect(existsSync(dbPath)).toBe(false);
    expect(existsSync(join(dir, "db"))).toBe(false);
  });

  it("invalid JSON content fails before any database file is created", () => {
    writeFileSync(join(jsonDir, "options.json"), "{ not json");
    expect(() => seedDatabase({ dbPath, jsonDir, dryRun: false })).toThrow(/not valid JSON/);
    expect(existsSync(dbPath)).toBe(false);
  });

  it("the report never shows option labels", () => {
    const report = seedDatabase({ dbPath, jsonDir, dryRun: false });
    expect(report).not.toMatch(/MARKER|is_?correct/i);
  });

  describe("keeping the database and the source in step", () => {
    const seed = (dryRun = false) => seedDatabase({ dbPath, jsonDir, dryRun });
    const rows = (sql: string): Record<string, unknown>[] => {
      const db = new DatabaseSync(dbPath, { readOnly: true });
      try {
        return db.prepare(sql).all();
      } finally {
        db.close();
      }
    };
    const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

    beforeEach(() => writeFixture(jsonDir, richFixture()));

    it("a stale mixed set fails with the counts error and creates no database file", () => {
      // questions.json from another run than the rest of the set
      const old = clone(richFixture());
      old.questions.pop();
      writeFileSync(join(jsonDir, "questions.json"), JSON.stringify(old.questions));
      expect(() => seed()).toThrow(
        "_report.json: counts.questions is 2 but questions.json has 1 rows",
      );
      expect(existsSync(dbPath)).toBe(false);
      expect(existsSync(join(dir, "db"))).toBe(false);
    });

    it("a set without _report.json is rejected and creates no database file", () => {
      rmSync(join(jsonDir, "_report.json"));
      expect(() => seed()).toThrow(/_report\.json not found.* Run \/raw-data-to-json first\./);
      expect(existsSync(dbPath)).toBe(false);
    });

    it("an unused topic is a warning in the report, not an error, and is not imported", () => {
      const fx = richFixture();
      fx.topics.push({ id: 3, name: "Gamma" });
      writeFixture(jsonDir, fx);
      const report = seed();
      expect(report).toContain("topics.json: topic 3 has no questions and is not imported");
      expect(rows("SELECT name FROM topics ORDER BY name").map((r) => r.name)).toEqual([
        "Alpha",
        "Beta",
      ]);
    });

    it("prints no `not in source` line when the database matches the source", () => {
      seed();
      expect(seed()).not.toContain("not in source");
    });

    it("an edited question text is inserted as new; the old row is reported, not deleted", () => {
      seed();
      const edited = richFixture();
      edited.questions[0] = { ...edited.questions[0], text: "TEST question 1 edited?" };
      writeFixture(jsonDir, edited);
      const oldId = Number(rows("SELECT id FROM questions WHERE text = 'TEST question 1?'")[0]?.id);

      const report = seed();
      expect(report).toContain("inserted: 0 topics, 0 notes, 1 questions, 3 options");
      expect(report).toContain(
        `in database but not in source: 1 questions (ids ${oldId}), 0 topics no source question uses (left untouched)`,
      );
      expect(questions()).toBe(3);
      expect(
        rows("SELECT id FROM questions WHERE text = 'TEST question 1?'").map((r) => Number(r.id)),
      ).toEqual([oldId]);
      expect(report).not.toMatch(/MARKER|is_?correct/i);
    });

    it("a renamed topic is created anew; the old topic is reported, not deleted", () => {
      seed();
      const renamed = richFixture();
      renamed.topics[0] = { ...renamed.topics[0], name: "Alpha renamed" };
      writeFixture(jsonDir, renamed);

      const report = seed();
      // question 2 sits in the renamed topic, so it is new there; the old Alpha question stays
      expect(report).toContain("inserted: 1 topics, 0 notes, 1 questions");
      expect(report).toContain("in database but not in source: 1 questions (ids 2), 1 topics");
      expect(rows("SELECT name FROM topics ORDER BY name").map((r) => r.name)).toEqual([
        "Alpha",
        "Alpha renamed",
        "Beta",
      ]);
    });

    it("changed note titles are printed one per line after the count line", () => {
      seed();
      const edited = richFixture();
      edited.notes[0] = { ...edited.notes[0], text: "Test note one, edited." };
      edited.notes[1] = { ...edited.notes[1], text: "Test note two, edited." };
      writeFixture(jsonDir, edited);

      const report = seed();
      expect(report).toContain(
        "changed in source (not updated): 2 notes\n  Note one\n  Note two\n",
      );
      expect(rows("SELECT text FROM short_notes WHERE title = 'Note one'")[0]?.text).toBe(
        "Test note one.",
      );
    });

    it("ids renumbered and reordered consistently in every file: inserts 0, no changes, nothing missing", () => {
      seed();
      const before = readFileSync(dbPath).length;
      const fx = clone(richFixture());
      // swap the local ids of the two topics, notes and questions (links and options follow)
      const swap = (id: unknown) => (id === 1 ? 2 : 1);
      const swapped: Fixture = {
        topics: fx.topics.map((t) => ({ ...t, id: swap(t.id) })).reverse(),
        notes: fx.notes.map((n) => ({ ...n, id: swap(n.id) })).reverse(),
        questions: fx.questions
          .map((q) => ({ ...q, id: swap(q.id), topic_id: swap(q.topic_id) }))
          .reverse(),
        options: fx.options
          .map((o, i) => ({ ...o, id: fx.options.length - i, question_id: swap(o.question_id) }))
          .reverse(),
        links: fx.links
          .map((l) => ({ question_id: swap(l.question_id), short_note_id: swap(l.short_note_id) }))
          .reverse(),
        // each question keeps its source number
        reportPatch: {
          question_numbers: [
            { id: 1, number: sourceNumber(2) },
            { id: 2, number: sourceNumber(1) },
          ],
        },
      };
      writeFixture(jsonDir, swapped);

      const report = seed();
      expect(report).toContain("inserted: 0 topics, 0 notes, 0 questions, 0 options, 0 links");
      expect(report).not.toContain("changed in source");
      expect(report).not.toContain("not in source");
      expect(questions()).toBe(2);
      expect(readFileSync(dbPath).length).toBe(before);
    });

    it("growth adds only the new question", () => {
      seed();
      const grown = richFixture();
      grown.questions.push({ id: 3, topic_id: 1, text: "TEST question 3?", explanation: "E3." });
      grown.options.push(
        { id: 6, question_id: 3, position: 1, label: "MARKER-3A", is_correct: 0 },
        { id: 7, question_id: 3, position: 2, label: "MARKER-3B", is_correct: 1 },
      );
      writeFixture(jsonDir, grown);
      const report = seed();
      expect(report).toContain("inserted: 0 topics, 0 notes, 1 questions, 2 options, 0 links");
      expect(report).not.toContain("not in source");
      expect(questions()).toBe(3);
    });
  });
});

describe("seedDatabase reads only the JSON set", () => {
  let dir: string;
  let jsonDir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "certsafary-jsononly-"));
    jsonDir = join(dir, "raw-data", "json");
    dbPath = join(dir, "db", "test.db");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const tableCount = (table: string): number => {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      return Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n);
    } finally {
      db.close();
    }
  };

  it("fails with the run-the-skill hint when raw-data/json is missing", () => {
    expect(() => seedDatabase({ dbPath, jsonDir, dryRun: false })).toThrow(
      /Run \/raw-data-to-json first/,
    );
    expect(existsSync(dbPath)).toBe(false);
  });

  it("fails with the same hint when only _report.json is missing", () => {
    writeFixture(jsonDir, { ...minimalFixture(), report: null });
    expect(() => seedDatabase({ dbPath, jsonDir, dryRun: false })).toThrow(
      /_report\.json not found.*Run \/raw-data-to-json first/,
    );
    expect(existsSync(dbPath)).toBe(false);
  });

  it("markdown notes next to a missing JSON set are not read: still fails, writes nothing", () => {
    // TEST DATA ONLY: well-formed markdown that would yield a question if anything read it.
    const rawDir = join(dir, "raw-data");
    mkdirSync(rawDir, { recursive: true });
    writeFileSync(join(rawDir, "_shortNotes.md"), "### Note one\n- Test note.\n");
    writeFileSync(
      join(rawDir, "_shortNotesSource.md"),
      "## 1. Alpha\n\n### Q1\nЗаметки: —\n\nTEST question?\n\n- A) MARKER-A\n- B) MARKER-B\n\n**Ответ: B**\n\n> Official: Correct. Test.\n",
    );
    for (const dryRun of [false, true]) {
      expect(() => seedDatabase({ dbPath, jsonDir, dryRun })).toThrow(
        /Run \/raw-data-to-json first/,
      );
    }
    expect(existsSync(dbPath)).toBe(false);
  });

  it("a corrupt set (two correct options) is rejected whole and the database is unchanged", () => {
    writeFixture(jsonDir, richFixture());
    seedDatabase({ dbPath, jsonDir, dryRun: false });
    const before = [tableCount("topics"), tableCount("questions"), tableCount("options")];

    const corrupt = richFixture();
    corrupt.options = corrupt.options.map((o) => (o.id === 2 ? { ...o, is_correct: 1 } : o));
    // A new valid question in the same set must not slip through either.
    corrupt.questions.push({ id: 3, topic_id: 1, text: "TEST question 3?", explanation: "E3." });
    corrupt.options.push(
      { id: 6, question_id: 3, position: 1, label: "MARKER-3A", is_correct: 0 },
      { id: 7, question_id: 3, position: 2, label: "MARKER-3B", is_correct: 1 },
    );
    writeFixture(jsonDir, corrupt);

    expect(() => seedDatabase({ dbPath, jsonDir, dryRun: false })).toThrow(
      /expected exactly one correct option/,
    );
    expect([tableCount("topics"), tableCount("questions"), tableCount("options")]).toEqual(before);
  });

  it("a corrupt set on a missing database creates no file", () => {
    const corrupt = minimalFixture();
    corrupt.options = corrupt.options.map((o) => ({ ...o, is_correct: 1 }));
    writeFixture(jsonDir, corrupt);
    expect(() => seedDatabase({ dbPath, jsonDir, dryRun: false })).toThrow(/exactly one correct/);
    expect(existsSync(dbPath)).toBe(false);
  });
});
