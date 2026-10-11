import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { importSeedData } from "../../src/db/import.js";
import type { SeedData } from "../../src/db/seed-json.js";
import { buildFixture, seedData } from "../helpers/seed-json.js";

// TEST DATA ONLY: synthetic JSON fixtures, not real exam content. SeedData comes only from
// loadSeedData (via the fixture helpers), the same gate that db:seed uses.

/** One question linked to "Note one"; `extra` adds a second question with three options. */
function source(explanation: string, extra = false): SeedData {
  return seedData(
    buildFixture({
      notes: ["Note one"],
      questions: [
        { text: "TEST question one?", explanation, notes: ["Note one"] },
        ...(extra
          ? [{ text: "TEST question two?", options: 3, explanation: "Second explanation." }]
          : []),
      ],
    }),
  );
}

const empty = (): SeedData => seedData(buildFixture({ questions: [] }));

function count(db: DatabaseSync, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

describe("importSeedData", () => {
  let db: DatabaseSync;
  let data: SeedData;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    data = source("First explanation.");
  });

  it("creates the schema and inserts topics, notes, questions and options", () => {
    const report = importSeedData(db, data);
    expect(report.inserted).toEqual({ topics: 1, notes: 1, questions: 1, options: 2, links: 1 });
    expect(count(db, "topics")).toBe(1);
    expect(count(db, "short_notes")).toBe(1);
    const question = db.prepare("SELECT explanation FROM questions").get() as {
      explanation: string;
    };
    expect(count(db, "question_short_notes")).toBe(1);
    expect(question.explanation).toBe("First explanation.");
  });

  it("stores exactly one correct option, at the position of the answer letter", () => {
    importSeedData(db, data);
    const correct = db.prepare("SELECT position FROM options WHERE is_correct = 1").all() as {
      position: number;
    }[];
    expect(correct).toEqual([{ position: 2 }]);
  });

  it("is idempotent: a second run inserts nothing", () => {
    importSeedData(db, data);
    const again = importSeedData(db, data);
    expect(again.inserted).toEqual({ topics: 0, notes: 0, questions: 0, options: 0, links: 0 });
    expect(again.existing).toEqual({ topics: 1, notes: 1, questions: 1 });
    expect(again.changed).toEqual({ notes: [], questions: [] });
    expect(count(db, "questions")).toBe(1);
    expect(count(db, "options")).toBe(2);
  });

  it("adds only the new question when the source grows", () => {
    importSeedData(db, data);
    const grown = source("First explanation.", true);
    const report = importSeedData(db, grown);
    expect(report.inserted).toEqual({ topics: 0, notes: 0, questions: 1, options: 3, links: 0 });
    expect(count(db, "questions")).toBe(2);
  });

  it("reports but never overwrites a question that changed in the source", () => {
    importSeedData(db, data);
    const edited = source("Edited explanation.");
    const report = importSeedData(db, edited);
    expect(report.changed.questions).toEqual([1]);
    expect(report.inserted.questions).toBe(0);
    const stored = db.prepare("SELECT explanation FROM questions").get() as { explanation: string };
    expect(stored.explanation).toBe("First explanation.");
  });

  it("reports a question whose note link changed in the source, without rewriting it", () => {
    const twoNotes = (linked: string) =>
      seedData(
        buildFixture({
          notes: ["Note one", "Note two"],
          questions: [
            { text: "TEST question one?", explanation: "First explanation.", notes: [linked] },
          ],
        }),
      );
    importSeedData(db, twoNotes("Note one"));
    // In the edited source Q1 is related to "Note two" only.
    const report = importSeedData(db, twoNotes("Note two"));
    expect(report.changed.questions).toEqual([1]);
    const stored = db
      .prepare(
        "SELECT n.title AS title FROM question_short_notes l JOIN short_notes n ON n.id = l.short_note_id",
      )
      .all() as { title: string }[];
    expect(stored.map((r) => r.title).sort()).toEqual(["Note one", "Note two"]);
    expect(report.inserted.links).toBe(1);
  });

  it("leaves the database untouched on a dry run, schema included", () => {
    const report = importSeedData(db, data, { dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.inserted.questions).toBe(1);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
    expect(tables).toEqual([]);
  });

  it("rolls everything back when a question does not end up with exactly one correct option", () => {
    importSeedData(db, empty());
    const broken: SeedData = {
      ...data,
      questions: data.questions.map((q) => ({ ...q, correctPosition: 99 })),
    };
    expect(() => importSeedData(db, broken)).toThrow(/exactly one correct option/);
    expect(count(db, "topics")).toBe(0);
    expect(count(db, "short_notes")).toBe(0);
    expect(count(db, "questions")).toBe(0);
  });

  it("a dry run after a real import changes nothing and still reports existing and changed rows", () => {
    importSeedData(db, data);
    const edited = source("Edited explanation.");
    const report = importSeedData(db, edited, { dryRun: true });
    expect(report.existing.questions).toBe(1);
    expect(report.changed.questions).toEqual([1]);
    expect(count(db, "questions")).toBe(1);
    expect(count(db, "options")).toBe(2);
  });

  it("leaves no open transaction after a failure, so the next import still works", () => {
    db.exec("CREATE TABLE topics (id INTEGER PRIMARY KEY, other TEXT)");
    expect(() => importSeedData(db, data)).toThrow();
    expect(db.isTransaction).toBe(false);
    db.exec("DROP TABLE topics");
    expect(importSeedData(db, data).inserted.questions).toBe(1);
  });

  it("never mentions the correct option in the report", () => {
    const report = importSeedData(db, data);
    const text = JSON.stringify(report);
    expect(text).not.toMatch(/MARKER|correct/i);
  });
});

describe("importSeedData option ids", () => {
  // TEST DATA ONLY: the correct option sits at position 1, 2, 3 and 4 in different questions.
  const specs = [1, 2, 3, 4].map((n) => ({ options: 4, correct: n }));
  const SOURCE_A = () => seedData(buildFixture({ questions: specs }));
  const SOURCE_B = () =>
    seedData(buildFixture({ questions: [...specs, { options: 4, correct: 3 }] }));

  let db: DatabaseSync;
  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
  });

  const rows = () =>
    db
      .prepare(
        "SELECT q.text AS q, o.id AS id, o.position AS position, o.is_correct AS c FROM options o JOIN questions q ON q.id = o.question_id ORDER BY o.id",
      )
      .all()
      .map((r) => ({
        q: String(r.q),
        id: Number(r.id),
        position: Number(r.position),
        c: Number(r.c),
      }));
  const byQuestion = () => {
    const map = new Map<string, ReturnType<typeof rows>>();
    for (const r of rows()) map.set(r.q, [...(map.get(r.q) ?? []), r]);
    return map;
  };

  it("option ids are consecutive and follow the position order within every question", () => {
    importSeedData(db, SOURCE_A());
    const groups = byQuestion();
    expect(groups.size).toBe(4);
    let previousLast = 0;
    for (const options of [...groups.values()].sort((a, b) => (a[0]?.id ?? 0) - (b[0]?.id ?? 0))) {
      const byId = [...options].sort((a, b) => a.id - b.id);
      expect(byId.map((o) => o.position)).toEqual([1, 2, 3, 4]);
      expect(byId[0]?.id).toBe(previousLast + 1);
      byId.forEach((o, i) => {
        expect(o.id).toBe((byId[0]?.id ?? 0) + i);
      });
      previousLast = byId[3]?.id ?? 0;
    }
  });

  it("the correct option is not always the one with the smallest id", () => {
    importSeedData(db, SOURCE_A());
    const groups = [...byQuestion().values()];
    const correctPositions = groups.map((g) => g.find((o) => o.c === 1)?.position).sort();
    expect(correctPositions).toEqual([1, 2, 3, 4]);
    const notSmallest = groups.filter((g) => {
      const smallest = Math.min(...g.map((o) => o.id));
      return g.find((o) => o.c === 1)?.id !== smallest;
    });
    expect(notSmallest.length).toBeGreaterThan(0);
    for (const g of groups) expect(g.filter((o) => o.c === 1)).toHaveLength(1);
  });

  it("a second run inserts nothing and keeps every id", () => {
    importSeedData(db, SOURCE_A());
    const before = rows();
    const again = importSeedData(db, SOURCE_A());
    expect(again.inserted.options).toBe(0);
    expect(again.inserted.questions).toBe(0);
    expect(rows()).toEqual(before);
  });

  it("growth continues ids after MAX(id) without collisions and keeps existing ids", () => {
    importSeedData(db, SOURCE_A());
    const before = rows();
    const maxBefore = Math.max(...before.map((r) => r.id));
    const report = importSeedData(db, SOURCE_B());
    expect(report.inserted.questions).toBe(1);
    expect(report.inserted.options).toBe(4);
    const after = rows();
    expect(after.slice(0, before.length)).toEqual(before);
    const added = after.slice(before.length);
    expect(added.map((r) => r.id)).toEqual([
      maxBefore + 1,
      maxBefore + 2,
      maxBefore + 3,
      maxBefore + 4,
    ]);
    expect(added.map((r) => r.position)).toEqual([1, 2, 3, 4]);
    expect(new Set(after.map((r) => r.id)).size).toBe(after.length);
  });

  describe("a data question without exactly one marked option", () => {
    const valid = () => SOURCE_A();
    const rowTotals = () =>
      ["topics", "short_notes", "questions", "options", "question_short_notes"].map((t) =>
        count(db, t),
      );

    const cases: [string, (q: SeedData["questions"][number]) => SeedData["questions"][number]][] = [
      ["no marked option", (q) => ({ ...q, correctPosition: 99 })],
      [
        "two marked options",
        (q) => ({
          ...q,
          options: q.options.map((o) => (o.position === 2 ? { ...o, position: 1 } : o)),
          correctPosition: 1,
        }),
      ],
    ];

    it.each(cases)("%s: reports Qn, rolls everything back, leaks no label", (_name, mutate) => {
      importSeedData(db, empty()); // creates the schema so the counts can be read
      const data = valid();
      const broken: SeedData = {
        ...data,
        questions: data.questions.map((q) => (q.number === 3 ? mutate(q) : q)),
      };
      let message = "";
      try {
        importSeedData(db, broken);
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }
      expect(message).toBe("Q3: expected exactly one correct option");
      expect(message).not.toMatch(/MARKER/);
      expect(db.isTransaction).toBe(false);
      expect(rowTotals()).toEqual([0, 0, 0, 0, 0]);
    });

    it("leaves an existing question untouched when a later question is broken", () => {
      importSeedData(db, SOURCE_A());
      const before = rows();
      const data = SOURCE_B();
      const broken: SeedData = {
        ...data,
        questions: data.questions.map((q) => (q.number === 5 ? { ...q, correctPosition: 99 } : q)),
      };
      expect(() => importSeedData(db, broken)).toThrow(/^Q5: expected exactly one correct option$/);
      expect(rows()).toEqual(before);
      expect(count(db, "questions")).toBe(4);
    });
  });
});
