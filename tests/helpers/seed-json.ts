import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSeedData, type SeedData, type SeedSummary } from "../../src/db/seed-json.js";

// TEST DATA ONLY: synthetic fixtures, not real exam content.
// Option labels are unique MARKER strings so that a leak is detectable.

export type Row = Record<string, unknown>;

/** The content of a raw-data/json directory, one array per file. */
export interface Fixture {
  topics: Row[];
  notes: Row[];
  questions: Row[];
  options: Row[];
  links: Row[];
  /**
   * `_report.json`. Undefined: a consistent report is generated from the rows (see `buildReport`).
   * `null`: no `_report.json` is written. Anything else is written as given.
   */
  report?: unknown;
  /** Shallow overrides on top of the generated report (ignored when `report` is set). */
  reportPatch?: Record<string, unknown>;
}

export const REQUIRED_FILES = [
  "topics.json",
  "short_notes.json",
  "questions.json",
  "options.json",
  "question_short_notes.json",
] as const;

/** One topic, one note, one question with two options and one link. */
export function minimalFixture(): Fixture {
  return {
    topics: [{ id: 1, name: "Alpha" }],
    notes: [{ id: 1, title: "Note one", text: "Test note." }],
    questions: [{ id: 1, topic_id: 1, text: "TEST question?", explanation: "Test explanation." }],
    options: [
      { id: 1, question_id: 1, position: 1, label: "MARKER-WRONG", is_correct: 0 },
      { id: 2, question_id: 1, position: 2, label: "MARKER-RIGHT", is_correct: 1 },
    ],
    links: [{ question_id: 1, short_note_id: 1 }],
  };
}

/**
 * Two topics, two notes, two questions. Question 1 has three options and both notes
 * (listed in reverse order), question 2 has two options and no note.
 */
export function richFixture(): Fixture {
  return {
    topics: [
      { id: 1, name: "Alpha" },
      { id: 2, name: "Beta" },
    ],
    notes: [
      { id: 1, title: "Note one", text: "Test note one." },
      { id: 2, title: "Note two", text: "Test note two." },
    ],
    questions: [
      { id: 1, topic_id: 2, text: "TEST question 1?", explanation: "Explanation 1." },
      { id: 2, topic_id: 1, text: "TEST question 2?", explanation: "Explanation 2." },
    ],
    options: [
      { id: 1, question_id: 1, position: 1, label: "MARKER-1A", is_correct: 0 },
      { id: 2, question_id: 1, position: 3, label: "MARKER-1C", is_correct: 0 },
      { id: 3, question_id: 1, position: 2, label: "MARKER-1B", is_correct: 1 },
      { id: 4, question_id: 2, position: 1, label: "MARKER-2A", is_correct: 1 },
      { id: 5, question_id: 2, position: 2, label: "MARKER-2B", is_correct: 0 },
    ],
    links: [
      { question_id: 1, short_note_id: 2 },
      { question_id: 1, short_note_id: 1 },
    ],
  };
}

/** Source `Qn` of a local question id in generated reports: deliberately not 1..n. */
export const sourceNumber = (id: number): number => id * 3 + 4;

/** A `_report.json` consistent with the fixture rows: right counts, every question numbered. */
export function buildReport(fx: Fixture): Record<string, unknown> {
  return {
    counts: {
      topics: fx.topics.length,
      short_notes: fx.notes.length,
      questions: fx.questions.length,
      options: fx.options.length,
      question_short_notes: fx.links.length,
    },
    skipped: [],
    warnings: [],
    question_numbers: fx.questions.map((q) => ({
      id: q.id,
      number: sourceNumber(Number(q.id)),
    })),
  };
}

/** Writes the fixture as the JSON files that `raw-data-to-json` produces. */
export function writeFixture(dir: string, fx: Fixture): void {
  mkdirSync(dir, { recursive: true });
  const put = (name: string, value: unknown) =>
    writeFileSync(join(dir, name), `${JSON.stringify(value, null, 2)}\n`);
  put("topics.json", fx.topics);
  put("short_notes.json", fx.notes);
  put("questions.json", fx.questions);
  put("options.json", fx.options);
  put("question_short_notes.json", fx.links);
  if (fx.report === null) return;
  put("_report.json", fx.report ?? { ...buildReport(fx), ...fx.reportPatch });
}

/** Writes the fixture to a temporary directory, loads it through `loadSeedData`, cleans up. */
export function loaded(fx: Fixture): { data: SeedData; summary: SeedSummary } {
  const dir = mkdtempSync(join(tmpdir(), "certsafary-fixture-"));
  try {
    writeFixture(dir, fx);
    return loadSeedData(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The only way server tests get SeedData: through the validating loader. */
export function seedData(fx: Fixture): SeedData {
  return loaded(fx).data;
}

export interface QuestionSpec {
  /** Question text; default `TEST question <n>?`. */
  text?: string;
  /** Number of options (default 2); labels are unique MARKER strings. */
  options?: number;
  /** Position of the correct option (default: the last one). */
  correct?: number;
  explanation?: string;
  /** Titles of the linked notes (must be listed in `notes`). */
  notes?: string[];
  topic?: string;
}

/**
 * Compact builder: topic "Alpha" (or the spec's topic), note titles in `notes`, questions numbered
 * 1..n in the report (`Qn`). Ids follow the list order.
 */
export function buildFixture(spec: {
  notes?: string[];
  questions: QuestionSpec[];
  reportPatch?: Record<string, unknown>;
}): Fixture {
  const noteTitles = spec.notes ?? [];
  const topicNames = [...new Set(spec.questions.map((q) => q.topic ?? "Alpha"))];
  if (topicNames.length === 0) topicNames.push("Alpha");
  const fx: Fixture = {
    topics: topicNames.map((name, i) => ({ id: i + 1, name })),
    notes: noteTitles.map((title, i) => ({ id: i + 1, title, text: `Test body of ${title}.` })),
    questions: [],
    options: [],
    links: [],
  };
  let optionId = 0;
  for (const [i, q] of spec.questions.entries()) {
    const id = i + 1;
    const total = q.options ?? 2;
    const correct = q.correct ?? total;
    fx.questions.push({
      id,
      topic_id: topicNames.indexOf(q.topic ?? "Alpha") + 1,
      text: q.text ?? `TEST question ${id}?`,
      explanation: q.explanation ?? `Test explanation ${id}.`,
    });
    for (let position = 1; position <= total; position++) {
      fx.options.push({
        id: ++optionId,
        question_id: id,
        position,
        label: `MARKER-${id}-${position}`,
        is_correct: position === correct ? 1 : 0,
      });
    }
    for (const title of q.notes ?? []) {
      const noteIndex = noteTitles.indexOf(title);
      if (noteIndex < 0) throw new Error(`buildFixture: unknown note ${title}`);
      fx.links.push({ question_id: id, short_note_id: noteIndex + 1 });
    }
  }
  fx.reportPatch = {
    question_numbers: fx.questions.map((q) => ({ id: q.id, number: Number(q.id) })),
    ...spec.reportPatch,
  };
  return fx;
}
