import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { type ImportReport, importSeedData } from "../../src/db/import.js";
import { formatReport } from "../../src/db/report.js";
import { buildFixture, loaded } from "../helpers/seed-json.js";

// TEST DATA ONLY: synthetic JSON fixtures. Every option label is a unique marker so a leak is
// detectable.

describe("import output never reveals the correct option", () => {
  // TEST DATA ONLY: one imported question and two skipped ones, as _report.json would list them.
  const loadedSet = () =>
    loaded(
      buildFixture({
        notes: ["Note one"],
        questions: [{ text: "TEST question one?", options: 3, correct: 2, notes: ["Note one"] }],
        reportPatch: {
          skipped: [
            { number: 2, reason: "answer letter has no matching option" },
            { number: 3, reason: "no answer options" },
          ],
          warnings: ["Q1: test warning"],
        },
      }),
    );

  it("formatReport prints counts, Qn numbers and skip reasons only", () => {
    const { data, summary } = loadedSet();
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    const report = importSeedData(db, data);
    const output = formatReport(report, summary, "test.db");

    expect(output).toContain("1 questions");
    expect(output).toContain("Q2:");
    expect(output).toContain("Q3:");
    expect(output).toContain("Q1: test warning");
    expect(output).not.toMatch(/MARKER/);
    expect(output).not.toMatch(/is_?correct/i);
    expect(output).not.toMatch(/correct (option|answer|position)/i);
  });

  it("the thrown error for a broken question names no option", () => {
    const { data } = loadedSet();
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    const broken = {
      ...data,
      questions: data.questions.map((q) => ({ ...q, correctPosition: 99 })),
    };
    expect(() => importSeedData(db, broken)).toThrow(/^Q1: expected exactly one correct option$/);
  });

  it("the loaded summary (skip reasons and warnings) contains no option text", () => {
    const { summary } = loadedSet();
    expect(JSON.stringify(summary)).not.toMatch(/MARKER/);
  });
});

describe("formatReport: database rows missing from the source", () => {
  const summary = { notes: 0, questions: 0, questionBlocks: 0, skipped: [], warnings: [] };
  const report = (over: Partial<ImportReport> = {}): ImportReport => ({
    inserted: { topics: 0, notes: 0, questions: 0, options: 0, links: 0 },
    existing: { topics: 0, notes: 0, questions: 0 },
    changed: { notes: [], questions: [] },
    notInSource: { questions: [], topics: 0 },
    dryRun: false,
    ...over,
  });

  it("prints no line when nothing is missing from the source", () => {
    expect(formatReport(report(), summary, "test.db")).not.toContain("not in source");
  });

  it("lists the database question ids and the topic count", () => {
    const output = formatReport(
      report({ notInSource: { questions: [4, 9], topics: 1 } }),
      summary,
      "test.db",
    );
    expect(output).toContain(
      "in database but not in source: 2 questions (ids 4, 9), 1 topics no source question uses (left untouched)",
    );
  });

  it("prints the line for a topic alone, without an id list", () => {
    const output = formatReport(
      report({ notInSource: { questions: [], topics: 2 } }),
      summary,
      "test.db",
    );
    expect(output).toContain(
      "in database but not in source: 0 questions, 2 topics no source question uses (left untouched)",
    );
  });

  it("lists the first 50 ids and then an ellipsis", () => {
    const ids = Array.from({ length: 60 }, (_, i) => i + 1);
    const output = formatReport(
      report({ notInSource: { questions: ids, topics: 0 } }),
      summary,
      "test.db",
    );
    expect(output).toContain(`60 questions (ids ${ids.slice(0, 50).join(", ")}, ...)`);
    expect(output).not.toContain("51,");
  });

  it("prints changed note titles one per line after the count line", () => {
    const output = formatReport(
      report({ changed: { notes: ["Note one", "Note two"], questions: [] } }),
      summary,
      "test.db",
    );
    expect(output).toContain("changed in source (not updated): 2 notes\n  Note one\n  Note two\n");
  });
});
