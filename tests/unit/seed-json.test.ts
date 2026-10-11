import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadSeedData, SeedDataError } from "../../src/db/seed-json.js";
import {
  buildReport,
  type Fixture,
  minimalFixture,
  REQUIRED_FILES,
  richFixture,
  sourceNumber,
  writeFixture,
} from "../helpers/seed-json.js";

// TEST DATA ONLY: synthetic fixtures, not real exam content.
// Option labels are MARKER strings: no error message may contain one.

/** A rich fixture whose generated _report.json is patched. */
const withReport = (patch: Record<string, unknown>): Fixture => ({
  ...richFixture(),
  reportPatch: patch,
});

const counts = (over: Record<string, number> = {}) => ({
  ...(buildReport(richFixture()).counts as Record<string, number>),
  ...over,
});

describe("loadSeedData", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "certquiz-seedjson-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /** The message of the SeedDataError that loading `fx` raises. */
  const errorOf = (fx: Fixture): string => {
    writeFixture(dir, fx);
    try {
      loadSeedData(dir);
    } catch (err) {
      expect(err).toBeInstanceOf(SeedDataError);
      return err instanceof Error ? err.message : "";
    }
    throw new Error("expected loadSeedData to throw");
  };

  describe("happy path", () => {
    it("resolves topic names and note titles, orders options and notes, derives correctPosition", () => {
      writeFixture(dir, richFixture());
      const { data } = loadSeedData(dir);
      expect(data.notes).toEqual([
        { title: "Note one", text: "Test note one." },
        { title: "Note two", text: "Test note two." },
      ]);
      expect(data.questions).toEqual([
        {
          number: sourceNumber(1),
          topic: "Beta",
          text: "TEST question 1?",
          explanation: "Explanation 1.",
          options: [
            { position: 1, label: "MARKER-1A" },
            { position: 2, label: "MARKER-1B" },
            { position: 3, label: "MARKER-1C" },
          ],
          correctPosition: 2,
          // linked as [2, 1] in the file, ordered by short_note_id
          noteTitles: ["Note one", "Note two"],
        },
        {
          number: sourceNumber(2),
          topic: "Alpha",
          text: "TEST question 2?",
          explanation: "Explanation 2.",
          options: [
            { position: 1, label: "MARKER-2A" },
            { position: 2, label: "MARKER-2B" },
          ],
          correctPosition: 1,
          noteTitles: [],
        },
      ]);
    });

    it("the loaded data has no is_correct field (the answer key is correctPosition only)", () => {
      writeFixture(dir, richFixture());
      const { data } = loadSeedData(dir);
      expect(JSON.stringify(data)).not.toMatch(/is_?correct/i);
    });

    it("takes `number` from _report.json question_numbers", () => {
      writeFixture(
        dir,
        withReport({
          question_numbers: [
            { id: 1, number: 41 },
            { id: 2, number: 17 },
          ],
        }),
      );
      expect(loadSeedData(dir).data.questions.map((q) => q.number)).toEqual([41, 17]);
    });

    it("accepts a source number of 0 in question_numbers and in skipped", () => {
      writeFixture(
        dir,
        withReport({
          question_numbers: [
            { id: 1, number: 0 },
            { id: 2, number: 9 },
          ],
          skipped: [{ number: 3, reason: "TEST reason" }],
        }),
      );
      const { data, summary } = loadSeedData(dir);
      expect(data.questions.map((q) => q.number)).toEqual([0, 9]);
      expect(summary.skipped).toEqual([{ number: 3, reason: "TEST reason" }]);
    });

    it("accepts a skipped source number of 0 next to other imported numbers", () => {
      writeFixture(dir, withReport({ skipped: [{ number: 0, reason: "TEST reason" }] }));
      const { summary } = loadSeedData(dir);
      expect(summary.skipped).toEqual([{ number: 0, reason: "TEST reason" }]);
    });

    it("rejects a number that is both skipped and imported", () => {
      expect(
        errorOf(withReport({ skipped: [{ number: sourceNumber(1), reason: "TEST reason" }] })),
      ).toBe(`_report.json: number ${sourceNumber(1)} is both skipped and imported`);
    });

    it("rejects the number 0 when it is both skipped and imported", () => {
      expect(
        errorOf(
          withReport({
            question_numbers: [
              { id: 1, number: 0 },
              { id: 2, number: 9 },
            ],
            skipped: [{ number: 0, reason: "TEST reason" }],
          }),
        ),
      ).toBe("_report.json: number 0 is both skipped and imported");
    });

    it("summary counts questionBlocks as questions plus skipped", () => {
      writeFixture(
        dir,
        withReport({
          skipped: [
            { number: 5, reason: "TEST reason" },
            { number: 6, reason: "TEST other" },
          ],
          warnings: ["TEST warning"],
        }),
      );
      expect(loadSeedData(dir).summary).toEqual({
        notes: 2,
        questions: 2,
        questionBlocks: 4,
        skipped: [
          { number: 5, reason: "TEST reason" },
          { number: 6, reason: "TEST other" },
        ],
        warnings: ["TEST warning"],
      });
    });

    it("a report without skipped questions or warnings gives an empty summary of both", () => {
      writeFixture(dir, richFixture());
      expect(loadSeedData(dir).summary).toEqual({
        notes: 2,
        questions: 2,
        questionBlocks: 2,
        skipped: [],
        warnings: [],
      });
    });

    it("warns about a topic without questions and does not import it as an error", () => {
      const fx = richFixture();
      fx.topics.push({ id: 3, name: "Gamma" });
      writeFixture(dir, fx);
      const { summary } = loadSeedData(dir);
      expect(summary.warnings).toEqual([
        "topics.json: topic 3 has no questions and is not imported",
      ]);
    });

    it("lists the report warnings before the unused-topic warnings", () => {
      const fx = { ...richFixture(), reportPatch: { warnings: ["TEST warning"] } };
      fx.topics.push({ id: 3, name: "Gamma" });
      writeFixture(dir, fx);
      expect(loadSeedData(dir).summary.warnings).toEqual([
        "TEST warning",
        "topics.json: topic 3 has no questions and is not imported",
      ]);
    });

    it("accepts the same question text in two different topics", () => {
      const fx = richFixture();
      fx.questions[1] = { ...fx.questions[1], text: "TEST question 1?" };
      writeFixture(dir, fx);
      expect(loadSeedData(dir).data.questions).toHaveLength(2);
    });
  });

  describe("files and directory", () => {
    it("rejects a missing directory", () => {
      const missing = join(dir, "nope");
      expect(() => loadSeedData(missing)).toThrow(SeedDataError);
      expect(() => loadSeedData(missing)).toThrow(
        `JSON directory ${missing} not found. Run /raw-data-to-json first.`,
      );
    });

    it("rejects a path that is a file, not a directory", () => {
      const file = join(dir, "file.json");
      writeFileSync(file, "[]");
      expect(() => loadSeedData(file)).toThrow(
        `JSON directory ${file} not found. Run /raw-data-to-json first.`,
      );
    });

    it.each(REQUIRED_FILES)("rejects a missing %s", (name) => {
      writeFixture(dir, richFixture());
      rmSync(join(dir, name));
      expect(() => loadSeedData(dir)).toThrow(SeedDataError);
      expect(() => loadSeedData(dir)).toThrow(
        `JSON file ${name} not found in ${dir}. Run /raw-data-to-json first.`,
      );
    });

    it("treats a directory in place of a required file as missing", () => {
      writeFixture(dir, richFixture());
      rmSync(join(dir, "options.json"));
      mkdirSync(join(dir, "options.json"));
      expect(() => loadSeedData(dir)).toThrow(
        `JSON file options.json not found in ${dir}. Run /raw-data-to-json first.`,
      );
    });

    it("_report.json is required", () => {
      writeFixture(dir, { ...richFixture(), report: null });
      expect(() => loadSeedData(dir)).toThrow(SeedDataError);
      expect(() => loadSeedData(dir)).toThrow(
        `JSON file _report.json not found in ${dir}. Run /raw-data-to-json first.`,
      );
    });

    it("an interrupted converter set (five files, no _report.json) is rejected", () => {
      writeFixture(dir, richFixture());
      rmSync(join(dir, "_report.json"));
      expect(() => loadSeedData(dir)).toThrow(/^JSON file _report\.json not found in /);
    });

    it("rejects a JSON file larger than 50 MB without reading it (sparse file)", () => {
      writeFixture(dir, richFixture());
      truncateSync(join(dir, "options.json"), 51 * 1024 * 1024);
      expect(() => loadSeedData(dir)).toThrow(SeedDataError);
      expect(() => loadSeedData(dir)).toThrow("options.json: file is larger than 50 MB");
    });

    it.each(REQUIRED_FILES)("rejects malformed JSON in %s", (name) => {
      writeFixture(dir, richFixture());
      writeFileSync(join(dir, name), "[ { not json");
      expect(() => loadSeedData(dir)).toThrow(SeedDataError);
      expect(() => loadSeedData(dir)).toThrow(`${name}: not valid JSON`);
    });

    it("rejects malformed JSON in _report.json", () => {
      writeFixture(dir, richFixture());
      writeFileSync(join(dir, "_report.json"), "{");
      expect(() => loadSeedData(dir)).toThrow("_report.json: not valid JSON");
    });

    it("rejects a file whose root is not an array", () => {
      writeFixture(dir, richFixture());
      writeFileSync(join(dir, "topics.json"), "{}");
      expect(() => loadSeedData(dir)).toThrow(/^topics\.json: \(root\): /);
    });
  });

  describe("row schema (strict)", () => {
    const cases: [string, (fx: Fixture) => void, RegExp][] = [
      [
        "topic id as a string",
        (fx) => (fx.topics[0] = { ...fx.topics[0], id: "1" }),
        /^topics\.json: 0\.id: /,
      ],
      [
        "topic id below 1",
        (fx) => (fx.topics[0] = { ...fx.topics[0], id: 0 }),
        /^topics\.json: 0\.id: /,
      ],
      [
        "topic id fractional",
        (fx) => (fx.topics[0] = { ...fx.topics[0], id: 1.5 }),
        /^topics\.json: 0\.id: /,
      ],
      [
        "topic name not a string",
        (fx) => (fx.topics[0] = { ...fx.topics[0], name: 7 }),
        /^topics\.json: 0\.name: /,
      ],
      [
        "extra key in a topic",
        (fx) => (fx.topics[0] = { ...fx.topics[0], extra: 1 }),
        /^topics\.json: 0: .*extra/,
      ],
      [
        "extra key in a note",
        (fx) => (fx.notes[1] = { ...fx.notes[1], extra: 1 }),
        /^short_notes\.json: 1: .*extra/,
      ],
      [
        "extra key in a question",
        (fx) => (fx.questions[0] = { ...fx.questions[0], extra: 1 }),
        /^questions\.json: 0: .*extra/,
      ],
      [
        "extra key in an option",
        (fx) => (fx.options[2] = { ...fx.options[2], extra: 1 }),
        /^options\.json: 2: .*extra/,
      ],
      [
        "extra key in a link",
        (fx) => (fx.links[0] = { ...fx.links[0], extra: 1 }),
        /^question_short_notes\.json: 0: .*extra/,
      ],
      [
        "missing key in a question",
        (fx) => (fx.questions[1] = { id: 2, topic_id: 1, text: "TEST x?" }),
        /^questions\.json: 1\.explanation: /,
      ],
      [
        "is_correct of 2",
        (fx) => (fx.options[0] = { ...fx.options[0], is_correct: 2 }),
        /^options\.json: 0\.is_correct: /,
      ],
      [
        "is_correct as a boolean",
        (fx) => (fx.options[0] = { ...fx.options[0], is_correct: true }),
        /^options\.json: 0\.is_correct: /,
      ],
      [
        "position below 1",
        (fx) => (fx.options[4] = { ...fx.options[4], position: 0 }),
        /^options\.json: 4\.position: /,
      ],
      [
        "position fractional",
        (fx) => (fx.options[4] = { ...fx.options[4], position: 1.5 }),
        /^options\.json: 4\.position: /,
      ],
      [
        "empty topic name",
        (fx) => (fx.topics[0] = { ...fx.topics[0], name: "" }),
        /^topics\.json: 0\.name: /,
      ],
      [
        "empty note title",
        (fx) => (fx.notes[0] = { ...fx.notes[0], title: "" }),
        /^short_notes\.json: 0\.title: /,
      ],
      [
        "empty note text",
        (fx) => (fx.notes[0] = { ...fx.notes[0], text: "" }),
        /^short_notes\.json: 0\.text: /,
      ],
      [
        "empty question text",
        (fx) => (fx.questions[0] = { ...fx.questions[0], text: "" }),
        /^questions\.json: 0\.text: /,
      ],
      [
        "empty explanation",
        (fx) => (fx.questions[0] = { ...fx.questions[0], explanation: "" }),
        /^questions\.json: 0\.explanation: /,
      ],
      [
        "empty option label",
        (fx) => (fx.options[0] = { ...fx.options[0], label: "" }),
        /^options\.json: 0\.label: /,
      ],
      [
        "leading space in a topic name",
        (fx) => (fx.topics[0] = { ...fx.topics[0], name: " Alpha" }),
        /^topics\.json: 0\.name: .*whitespace/,
      ],
      [
        "trailing space in a note title",
        (fx) => (fx.notes[0] = { ...fx.notes[0], title: "Note one " }),
        /^short_notes\.json: 0\.title: .*whitespace/,
      ],
      [
        "trailing newline in a note text",
        (fx) => (fx.notes[0] = { ...fx.notes[0], text: "Test note.\n" }),
        /^short_notes\.json: 0\.text: .*whitespace/,
      ],
      [
        "padded question text",
        (fx) => (fx.questions[0] = { ...fx.questions[0], text: " TEST q? " }),
        /^questions\.json: 0\.text: .*whitespace/,
      ],
      [
        "padded explanation",
        (fx) => (fx.questions[0] = { ...fx.questions[0], explanation: "x\t" }),
        /^questions\.json: 0\.explanation: .*whitespace/,
      ],
      [
        "padded option label",
        (fx) => (fx.options[0] = { ...fx.options[0], label: " MARKER-1A" }),
        /^options\.json: 0\.label: .*whitespace/,
      ],
      [
        "whitespace-only label",
        (fx) => (fx.options[0] = { ...fx.options[0], label: "   " }),
        /^options\.json: 0\.label: .*whitespace/,
      ],
    ];

    it.each(cases)("rejects %s", (_name, mutate, expected) => {
      const fx = richFixture();
      mutate(fx);
      const message = errorOf(fx);
      expect(message).toMatch(expected);
      expect(message).not.toMatch(/MARKER/);
    });

    const reportCases: [string, Fixture, RegExp][] = [
      ["an extra key in _report.json", withReport({ extra: 1 }), /^_report\.json: .*extra/],
      [
        "an extra key in counts",
        withReport({ counts: { ...counts(), extra: 1 } }),
        /^_report\.json: counts: .*extra/,
      ],
      [
        "a missing key in counts",
        withReport({ counts: { topics: 2 } }),
        /^_report\.json: counts\.short_notes: /,
      ],
      [
        "a negative count",
        withReport({ counts: counts({ topics: -1 }) }),
        /^_report\.json: counts\.topics: /,
      ],
      [
        "an extra key in a question_numbers entry",
        withReport({ question_numbers: [{ id: 1, number: 1, x: 1 }] }),
        /^_report\.json: question_numbers\.0: .*x/,
      ],
      [
        "a negative question number",
        withReport({ question_numbers: [{ id: 1, number: -1 }] }),
        /^_report\.json: question_numbers\.0\.number: /,
      ],
      [
        "a negative skipped number",
        withReport({ skipped: [{ number: -1, reason: "r" }] }),
        /^_report\.json: skipped\.0\.number: /,
      ],
      [
        "warnings that are not strings",
        withReport({ warnings: [1] }),
        /^_report\.json: warnings\.0: /,
      ],
      [
        "a skipped reason of 301 characters",
        withReport({ skipped: [{ number: 5, reason: "r".repeat(301) }] }),
        /^_report\.json: skipped\.0\.reason: /,
      ],
      [
        "a warning of 301 characters",
        withReport({ warnings: ["w".repeat(301)] }),
        /^_report\.json: warnings\.0: /,
      ],
    ];

    it.each(reportCases)("rejects %s", (_name, fx, expected) => {
      expect(errorOf(fx)).toMatch(expected);
    });

    it("accepts a skipped reason and a warning of exactly 300 characters, and 299", () => {
      writeFixture(
        dir,
        withReport({
          skipped: [
            { number: 5, reason: "r".repeat(300) },
            { number: 6, reason: "r".repeat(299) },
          ],
          warnings: ["w".repeat(300), "w".repeat(299)],
        }),
      );
      const { summary } = loadSeedData(dir);
      expect(summary.skipped.map((s) => s.reason.length)).toEqual([300, 299]);
      expect(summary.warnings.map((w) => w.length)).toEqual([300, 299]);
    });
  });

  describe("cross-file rules", () => {
    const cases: [string, (fx: Fixture) => void, string][] = [
      [
        "duplicate topic id",
        (fx) => (fx.topics[1] = { ...fx.topics[1], id: 1 }),
        "topics.json: duplicate id 1",
      ],
      [
        "duplicate note id",
        (fx) => (fx.notes[1] = { ...fx.notes[1], id: 1 }),
        "short_notes.json: duplicate id 1",
      ],
      [
        "duplicate question id",
        (fx) => (fx.questions[1] = { ...fx.questions[1], id: 1 }),
        "questions.json: duplicate id 1",
      ],
      [
        "duplicate option id",
        (fx) => (fx.options[1] = { ...fx.options[1], id: 1 }),
        "options.json: duplicate id 1",
      ],
      [
        "unknown topic_id",
        (fx) => (fx.questions[1] = { ...fx.questions[1], topic_id: 9 }),
        "questions.json: id 2: unknown topic_id 9",
      ],
      [
        "option with unknown question_id",
        (fx) => (fx.options[0] = { ...fx.options[0], question_id: 9 }),
        "options.json: id 1: unknown question_id 9",
      ],
      [
        "link with unknown question_id",
        (fx) => (fx.links[0] = { ...fx.links[0], question_id: 9 }),
        "question_short_notes.json: row 0: unknown question_id 9",
      ],
      [
        "link with unknown short_note_id",
        (fx) => (fx.links[1] = { ...fx.links[1], short_note_id: 9 }),
        "question_short_notes.json: row 1: unknown short_note_id 9",
      ],
      [
        "repeated question/note pair",
        (fx) => fx.links.push({ question_id: 1, short_note_id: 2 }),
        "question_short_notes.json: row 2: duplicate pair",
      ],
      [
        "duplicate topic name",
        (fx) => (fx.topics[1] = { ...fx.topics[1], name: "Alpha" }),
        "topics.json: id 2: duplicate name",
      ],
      [
        "duplicate note title",
        (fx) => (fx.notes[1] = { ...fx.notes[1], title: "Note one" }),
        "short_notes.json: id 2: duplicate title",
      ],
      [
        "duplicate (topic, text)",
        (fx) => (fx.questions[1] = { ...fx.questions[1], topic_id: 2, text: "TEST question 1?" }),
        "questions.json: id 2: duplicate text within the topic",
      ],
    ];

    it.each(cases)("rejects %s", (_name, mutate, expected) => {
      const fx = richFixture();
      mutate(fx);
      const message = errorOf(fx);
      expect(message).toBe(expected);
      expect(message).not.toMatch(/MARKER/);
    });
  });

  describe("option rules", () => {
    const cases: [string, (fx: Fixture) => void, string][] = [
      [
        "a question with a single option",
        (fx) => (fx.options = fx.options.filter((o) => o.id !== 5)),
        "options.json: question 2: fewer than 2 options",
      ],
      [
        "a question with no options",
        (fx) => (fx.options = fx.options.filter((o) => o.question_id !== 2)),
        "options.json: question 2: fewer than 2 options",
      ],
      [
        "duplicate positions",
        (fx) => (fx.options[4] = { ...fx.options[4], position: 1 }),
        "options.json: question 2: positions must be 1..n",
      ],
      [
        "a position gap {1,3}",
        (fx) => (fx.options[4] = { ...fx.options[4], position: 3 }),
        "options.json: question 2: positions must be 1..n",
      ],
      [
        "positions that start at 2 {2,3}",
        (fx) => {
          fx.options[3] = { ...fx.options[3], position: 2 };
          fx.options[4] = { ...fx.options[4], position: 3 };
        },
        "options.json: question 2: positions must be 1..n",
      ],
      [
        "duplicate option labels",
        (fx) => (fx.options[4] = { ...fx.options[4], label: "MARKER-2A" }),
        "options.json: question 2: duplicate option labels",
      ],
      [
        "no correct option",
        (fx) => (fx.options[3] = { ...fx.options[3], is_correct: 0 }),
        "options.json: question 2: expected exactly one correct option, found 0",
      ],
      [
        "two correct options",
        (fx) => (fx.options[4] = { ...fx.options[4], is_correct: 1 }),
        "options.json: question 2: expected exactly one correct option, found 2",
      ],
    ];

    it.each(cases)("rejects %s", (_name, mutate, expected) => {
      const fx = richFixture();
      mutate(fx);
      const message = errorOf(fx);
      expect(message).toBe(expected);
      expect(message).not.toMatch(/MARKER/);
    });
  });

  describe("_report.json counts", () => {
    const keys = [
      ["topics", "topics.json", 2],
      ["short_notes", "short_notes.json", 2],
      ["questions", "questions.json", 2],
      ["options", "options.json", 5],
      ["question_short_notes", "question_short_notes.json", 2],
    ] as const;

    it.each(keys)("rejects a wrong counts.%s", (key, file, actual) => {
      const message = errorOf(withReport({ counts: counts({ [key]: actual + 1 }) }));
      expect(message).toBe(
        `_report.json: counts.${key} is ${actual + 1} but ${file} has ${actual} rows`,
      );
    });

    it("rejects a stale mixed set: questions.json from another run than the report", () => {
      writeFixture(dir, richFixture());
      const questions: unknown = JSON.parse(readFileSync(join(dir, "questions.json"), "utf8"));
      expect(Array.isArray(questions)).toBe(true);
      const shorter = Array.isArray(questions) ? questions.slice(0, 1) : [];
      writeFileSync(join(dir, "questions.json"), JSON.stringify(shorter));
      expect(() => loadSeedData(dir)).toThrow(
        "_report.json: counts.questions is 2 but questions.json has 1 rows",
      );
    });
  });

  describe("_report.json question_numbers", () => {
    it("rejects an unknown question id", () => {
      const fx = withReport({
        question_numbers: [
          { id: 1, number: 1 },
          { id: 2, number: 2 },
          { id: 9, number: 3 },
        ],
      });
      expect(errorOf(fx)).toBe("_report.json: question_numbers: unknown question id 9");
    });

    it("rejects a duplicate id", () => {
      const fx = withReport({
        question_numbers: [
          { id: 1, number: 1 },
          { id: 1, number: 2 },
        ],
      });
      expect(errorOf(fx)).toBe("_report.json: question_numbers: duplicate id 1");
    });

    it("rejects the same source number for two ids", () => {
      const fx = withReport({
        question_numbers: [
          { id: 1, number: 5 },
          { id: 2, number: 5 },
        ],
      });
      expect(errorOf(fx)).toBe("_report.json: question_numbers: duplicate number 5");
    });

    it("rejects a question that has no number", () => {
      const fx = withReport({ question_numbers: [{ id: 2, number: 30 }] });
      expect(errorOf(fx)).toBe("_report.json: question_numbers: no number for question id 1");
    });

    it("rejects a report without the question_numbers key (no fallback to the id)", () => {
      const { question_numbers: _omitted, ...rest } = buildReport(richFixture());
      expect(errorOf({ ...richFixture(), report: rest })).toMatch(
        /^_report\.json: question_numbers: /,
      );
    });
  });

  it("loads the minimal fixture", () => {
    writeFixture(dir, minimalFixture());
    expect(loadSeedData(dir).summary.questions).toBe(1);
  });
});

describe("loadSeedData on the real raw-data/json (skipped when absent; read-only)", () => {
  const realDir = resolve(import.meta.dirname, "../../raw-data/json");
  // A stale local set from an older converter has no _report.json: skip rather than fail.
  const present =
    existsSync(join(realDir, "questions.json")) && existsSync(join(realDir, "_report.json"));

  it.skipIf(!present)("loads, and its counts agree with _report.json", () => {
    const { data, summary } = loadSeedData(realDir);
    expect(data.questions.length).toBeGreaterThan(0);
    expect(summary.questions).toBe(data.questions.length);
    expect(summary.notes).toBe(data.notes.length);
    expect(summary.questionBlocks).toBe(summary.questions + summary.skipped.length);
    // Positions only, never their values: a failure must not print the answer key.
    const sequential = data.questions.every((q) => q.options.every((o, i) => o.position === i + 1));
    expect(sequential).toBe(true);
    expect(data.questions.every((q) => q.options.length >= 2)).toBe(true);
  });
});
