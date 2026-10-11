import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedDatabase } from "../../../src/db/run-seed.js";
import { makeConvertRoot, runConvert } from "./convert-layout.js";

// TEST DATA ONLY: synthetic fixtures, not real exam content.
// End to end: markdown -> convert.mts (subprocess) -> raw-data/json -> seedDatabase -> SQLite.
// Source numbers are deliberately not 1..n so that a Qn is never confused with a row id.

const LINK_TARGET = "_shortNotes.md#L9999";

const NOTES = `### Note one
- Test body of Note one.
- Вопросы: [Q3](x)

### Note two
- Test body of Note two.
- Вопросы: [Q3](x), [Q7](x)
`;

const block = (n: number, text: string, links: string, right: string) => `### Q${n}
Заметки: ${links}

${text}

- A) MARKER-${n}-A
- B) MARKER-${n}-B

**Ответ: ${right}**

> Official: Correct. Explanation Q${n}.
`;

const SOURCE = `## 1. Alpha

${block(3, "TEST question three?", `[Note one](${LINK_TARGET}), [Note two](${LINK_TARGET})`, "B")}
${block(7, "TEST question seven?", `[Note two](${LINK_TARGET})`, "A")}
### Q8
Заметки: —

TEST open-ended question eight?

## 2. Beta

${block(9, "TEST question nine?", "—", "B")}`;

describe("pipeline: markdown -> JSON -> database", () => {
  let root: string;
  let jsonDir: string;
  let dbPath: string;

  beforeEach(() => {
    root = makeConvertRoot(NOTES, SOURCE);
    jsonDir = join(root, "raw-data/json");
    dbPath = join(root, "db/test.db");

    const result = runConvert(root);
    expect(result.stderr).not.toMatch(/Error/);
    expect(result.status).toBe(0);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const readJson = (name: string): unknown => JSON.parse(readFileSync(join(jsonDir, name), "utf8"));

  const withDb = <T>(fn: (db: DatabaseSync) => T): T => {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      return fn(db);
    } finally {
      db.close();
    }
  };
  const count = (table: string): number =>
    withDb((db) => Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n));

  const seed = (dryRun = false) => seedDatabase({ dbPath, jsonDir, dryRun });

  it("_report.json maps every question id to its source number and holds no option content", () => {
    const report = readJson("_report.json");
    expect(report).toMatchObject({
      counts: { topics: 2, short_notes: 2, questions: 3, options: 6, question_short_notes: 3 },
      skipped: [{ number: 8, reason: "no options in the source (open-ended question)" }],
      question_numbers: [
        { id: 1, number: 3 },
        { id: 2, number: 7 },
        { id: 3, number: 9 },
      ],
    });
    expect(readFileSync(join(jsonDir, "_report.json"), "utf8")).not.toMatch(/MARKER|is_?correct/i);
  });

  it("seeds the expected rows", () => {
    const report = seed();
    expect(report).toContain("inserted: 2 topics, 2 notes, 3 questions, 6 options, 3 links");
    expect(count("topics")).toBe(2);
    expect(count("short_notes")).toBe(2);
    expect(count("questions")).toBe(3);
    expect(count("options")).toBe(6);
    expect(count("question_short_notes")).toBe(3);
  });

  it("stores the many-to-many pairs", () => {
    seed();
    const pairs = withDb((db) =>
      db
        .prepare(
          "SELECT q.text AS q, n.title AS n FROM question_short_notes l JOIN questions q ON q.id = l.question_id JOIN short_notes n ON n.id = l.short_note_id ORDER BY q.text, n.title",
        )
        .all()
        .map((r) => `${String(r.q)} -> ${String(r.n)}`),
    );
    expect(pairs).toEqual([
      "TEST question seven? -> Note two",
      "TEST question three? -> Note one",
      "TEST question three? -> Note two",
    ]);
  });

  it("every question has exactly one correct option, matching the source answer", () => {
    seed();
    const rows = withDb((db) =>
      db
        .prepare(
          "SELECT q.text AS q, COUNT(*) AS total, SUM(o.is_correct) AS correct FROM questions q JOIN options o ON o.question_id = q.id GROUP BY q.id",
        )
        .all(),
    );
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(Number(row.total)).toBe(2);
      expect(Number(row.correct)).toBe(1);
    }
    const correctLabel = (text: string) =>
      withDb((db) =>
        String(
          db
            .prepare(
              "SELECT o.label AS l FROM options o JOIN questions q ON q.id = o.question_id WHERE q.text = ? AND o.is_correct = 1",
            )
            .get(text)?.l,
        ),
      );
    expect(correctLabel("TEST question three?")).toBe("MARKER-3-B");
    expect(correctLabel("TEST question seven?")).toBe("MARKER-7-A");
    expect(correctLabel("TEST question nine?")).toBe("MARKER-9-B");
  });

  it("option ids follow positions and the correct option is not always the first", () => {
    seed();
    const options = withDb((db) =>
      db
        .prepare("SELECT question_id AS q, id, position, is_correct AS c FROM options ORDER BY id")
        .all()
        .map((r) => ({
          q: Number(r.q),
          id: Number(r.id),
          position: Number(r.position),
          c: Number(r.c),
        })),
    );
    expect(options.map((o) => o.id)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const q of new Set(options.map((o) => o.q))) {
      const own = options.filter((o) => o.q === q);
      expect(own.map((o) => o.position)).toEqual([1, 2]);
      expect(own.filter((o) => o.c === 1)).toHaveLength(1);
    }
    const firstIsCorrect = options.filter((o) => o.position === 1 && o.c === 1).length;
    expect(firstIsCorrect).toBeLessThan(3);
  });

  it("a second run inserts nothing and changes nothing", () => {
    seed();
    const again = seed();
    expect(again).toContain("inserted: 0 topics, 0 notes, 0 questions, 0 options, 0 links");
    expect(again).not.toContain("changed in source");
    expect(count("questions")).toBe(3);
    expect(count("options")).toBe(6);
  });

  it("a dry run writes nothing, not even the database file", () => {
    const report = seed(true);
    expect(report).toContain("DRY RUN");
    expect(report).toContain("3 questions");
    expect(existsSync(dbPath)).toBe(false);
    expect(existsSync(join(root, "db"))).toBe(false);
  });

  it("the report names skipped questions by their source number and never leaks options", () => {
    const report = seed();
    expect(report).toContain("parsed: 2 notes, 3/4 questions");
    expect(report).toContain("skipped 1 questions:");
    expect(report).toContain("  Q8: no options in the source (open-ended question)");
    expect(report).not.toMatch(/MARKER|is_?correct/i);
  });

  it("a changed explanation is reported by its source Qn and never overwritten", () => {
    seed();
    const path = join(jsonDir, "questions.json");
    const rows: unknown = JSON.parse(readFileSync(path, "utf8"));
    expect(Array.isArray(rows)).toBe(true);
    const edited = Array.isArray(rows)
      ? rows.map((row: object, i) => (i === 1 ? { ...row, explanation: "TEST edited." } : row))
      : [];
    writeFileSync(path, JSON.stringify(edited));

    const report = seed();
    expect(report).toContain("changed in source (not updated): questions Q7");
    expect(report).toContain("questions Q7\n");
    expect(report).toContain("inserted: 0 topics, 0 notes, 0 questions");
    const stored = withDb((db) =>
      db
        .prepare("SELECT explanation AS e FROM questions WHERE text = 'TEST question seven?'")
        .get(),
    );
    expect(stored?.e).toBe("Explanation Q7.");
    expect(report).not.toMatch(/MARKER|is_?correct/i);
  });
});
