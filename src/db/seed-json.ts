/**
 * Reader for the JSON files that the raw-data-to-json skill writes to raw-data/json/.
 * This is the input of `npm run db:seed`. No DB, no MCP, no HTTP: files in, plain objects out.
 * Every violation is an error (nothing is guessed or repaired). Messages name the file, the row
 * and the rule, never option text and never which option is correct.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { AppError } from "../lib/errors.js";

export class SeedDataError extends AppError {}

const id = z.number().int().min(1);
const text = z
  .string()
  .min(1)
  .refine((s) => s.trim() === s, "must not have leading or trailing whitespace");

const topicRow = z.strictObject({ id, name: text });
const noteRow = z.strictObject({ id, title: text, text });
const questionRow = z.strictObject({ id, topic_id: id, text, explanation: text });
const optionRow = z.strictObject({
  id,
  question_id: id,
  position: z.number().int().min(1),
  label: text,
  is_correct: z.union([z.literal(0), z.literal(1)]),
});
const linkRow = z.strictObject({ question_id: id, short_note_id: id });
const count = z.number().int().min(0);
/**
 * `skipped[].reason` and `warnings[]` are the output of the raw-data-to-json skill, validated here, and are printed
 * as they are; the length cap only stops a hand-edited or corrupt file from flooding the terminal.
 */
const MAX_TEXT = 300;
const reportSchema = z.strictObject({
  counts: z.strictObject({
    topics: count,
    short_notes: count,
    questions: count,
    options: count,
    question_short_notes: count,
  }),
  // A source `Qn` can be 0 or more.
  skipped: z.array(
    z.strictObject({ number: z.number().int().min(0), reason: z.string().max(MAX_TEXT) }),
  ),
  warnings: z.array(z.string().max(MAX_TEXT)),
  question_numbers: z.array(z.strictObject({ id, number: z.number().int().min(0) })),
});

/** A JSON file above this size is refused before it is read. */
const MAX_FILE_BYTES = 50 * 1024 * 1024;

export interface SeedNote {
  title: string;
  text: string;
}

export interface SeedQuestion {
  /** Source `Qn`, from _report.json question_numbers. */
  number: number;
  /** Topic name. */
  topic: string;
  text: string;
  explanation: string;
  options: { position: number; label: string }[];
  /** Position of the correct option. Never print it. */
  correctPosition: number;
  /** Titles of the linked notes, ordered by short_note_id. */
  noteTitles: string[];
}

/**
 * What `importSeedData` needs. `importSeedData` trusts it: the validation in `loadSeedData`
 * (this file) is the gate, so build SeedData only from there.
 */
export interface SeedData {
  notes: SeedNote[];
  questions: SeedQuestion[];
}

/** What `formatReport` needs (`ReportSummary` in report.ts accepts it structurally). */
export interface SeedSummary {
  notes: number;
  questions: number;
  questionBlocks: number;
  skipped: { number: number; reason: string }[];
  warnings: string[];
}

function read<T extends z.ZodType>(dir: string, name: string, schema: T): z.infer<T> {
  const path = join(dir, name);
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new SeedDataError(`JSON file ${name} not found in ${dir}. Run /raw-data-to-json first.`);
  }
  if (statSync(path).size > MAX_FILE_BYTES) {
    throw new SeedDataError(`${name}: file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB`);
  }
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new SeedDataError(`${name}: not valid JSON`);
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue ? issue.path.map(String).join(".") || "(root)" : "(root)";
    throw new SeedDataError(`${name}: ${where}: ${issue?.message ?? "invalid"}`);
  }
  return result.data;
}

/** Rows keyed by id; a repeated id is an error. */
function byId<R extends { id: number }>(file: string, rows: R[]): Map<number, R> {
  const map = new Map<number, R>();
  for (const row of rows) {
    if (map.has(row.id)) throw new SeedDataError(`${file}: duplicate id ${row.id}`);
    map.set(row.id, row);
  }
  return map;
}

function unique(file: string, what: string, keys: Iterable<[number, string]>): void {
  const seen = new Set<string>();
  for (const [rowId, key] of keys) {
    if (seen.has(key)) throw new SeedDataError(`${file}: id ${rowId}: duplicate ${what}`);
    seen.add(key);
  }
}

/** Reads and validates the five data files and _report.json (all required) in jsonDir. */
export function loadSeedData(jsonDir: string): { data: SeedData; summary: SeedSummary } {
  if (!existsSync(jsonDir) || !statSync(jsonDir).isDirectory()) {
    throw new SeedDataError(`JSON directory ${jsonDir} not found. Run /raw-data-to-json first.`);
  }
  const topics = read(jsonDir, "topics.json", z.array(topicRow));
  const notes = read(jsonDir, "short_notes.json", z.array(noteRow));
  const questions = read(jsonDir, "questions.json", z.array(questionRow));
  const options = read(jsonDir, "options.json", z.array(optionRow));
  const links = read(jsonDir, "question_short_notes.json", z.array(linkRow));
  const report = read(jsonDir, "_report.json", reportSchema);

  const lengths: [keyof typeof report.counts, string, number][] = [
    ["topics", "topics.json", topics.length],
    ["short_notes", "short_notes.json", notes.length],
    ["questions", "questions.json", questions.length],
    ["options", "options.json", options.length],
    ["question_short_notes", "question_short_notes.json", links.length],
  ];
  for (const [key, file, actual] of lengths) {
    if (report.counts[key] !== actual) {
      throw new SeedDataError(
        `_report.json: counts.${key} is ${report.counts[key]} but ${file} has ${actual} rows`,
      );
    }
  }

  const topicById = byId("topics.json", topics);
  const noteById = byId("short_notes.json", notes);
  const questionById = byId("questions.json", questions);
  byId("options.json", options);
  unique(
    "topics.json",
    "name",
    topics.map((t) => [t.id, t.name]),
  );
  unique(
    "short_notes.json",
    "title",
    notes.map((n) => [n.id, n.title]),
  );
  unique(
    "questions.json",
    "text within the topic",
    questions.map((q) => [q.id, `${q.topic_id}\u0000${q.text}`]),
  );

  const optionsOf = new Map<number, typeof options>();
  for (const o of options) {
    if (!questionById.has(o.question_id)) {
      throw new SeedDataError(`options.json: id ${o.id}: unknown question_id ${o.question_id}`);
    }
    const list = optionsOf.get(o.question_id) ?? [];
    list.push(o);
    optionsOf.set(o.question_id, list);
  }

  const noteIdsOf = new Map<number, Set<number>>();
  for (const [i, l] of links.entries()) {
    if (!questionById.has(l.question_id)) {
      throw new SeedDataError(
        `question_short_notes.json: row ${i}: unknown question_id ${l.question_id}`,
      );
    }
    if (!noteById.has(l.short_note_id)) {
      throw new SeedDataError(
        `question_short_notes.json: row ${i}: unknown short_note_id ${l.short_note_id}`,
      );
    }
    const set = noteIdsOf.get(l.question_id) ?? new Set<number>();
    if (set.has(l.short_note_id)) {
      throw new SeedDataError(`question_short_notes.json: row ${i}: duplicate pair`);
    }
    set.add(l.short_note_id);
    noteIdsOf.set(l.question_id, set);
  }

  const numberOf = new Map<number, number>();
  const usedNumbers = new Set<number>();
  for (const m of report.question_numbers) {
    if (!questionById.has(m.id)) {
      throw new SeedDataError(`_report.json: question_numbers: unknown question id ${m.id}`);
    }
    if (numberOf.has(m.id)) {
      throw new SeedDataError(`_report.json: question_numbers: duplicate id ${m.id}`);
    }
    if (usedNumbers.has(m.number)) {
      throw new SeedDataError(`_report.json: question_numbers: duplicate number ${m.number}`);
    }
    usedNumbers.add(m.number);
    numberOf.set(m.id, m.number);
  }
  for (const s of report.skipped) {
    if (usedNumbers.has(s.number)) {
      throw new SeedDataError(`_report.json: number ${s.number} is both skipped and imported`);
    }
  }
  for (const q of questions) {
    if (!numberOf.has(q.id)) {
      throw new SeedDataError(`_report.json: question_numbers: no number for question id ${q.id}`);
    }
  }

  const seedQuestions: SeedQuestion[] = questions.map((q) => {
    const topic = topicById.get(q.topic_id);
    if (!topic)
      throw new SeedDataError(`questions.json: id ${q.id}: unknown topic_id ${q.topic_id}`);
    const number = numberOf.get(q.id);
    if (number === undefined) {
      throw new SeedDataError(`_report.json: question_numbers: no number for question id ${q.id}`);
    }
    const own = [...(optionsOf.get(q.id) ?? [])].sort((a, b) => a.position - b.position);
    if (own.length < 2)
      throw new SeedDataError(`options.json: question ${q.id}: fewer than 2 options`);
    if (!own.every((o, i) => o.position === i + 1)) {
      throw new SeedDataError(`options.json: question ${q.id}: positions must be 1..n`);
    }
    if (new Set(own.map((o) => o.label)).size !== own.length) {
      throw new SeedDataError(`options.json: question ${q.id}: duplicate option labels`);
    }
    const correct = own.filter((o) => o.is_correct === 1);
    const first = correct[0];
    if (correct.length !== 1 || !first) {
      throw new SeedDataError(
        `options.json: question ${q.id}: expected exactly one correct option, found ${correct.length}`,
      );
    }
    const noteTitles = [...(noteIdsOf.get(q.id) ?? [])]
      .sort((a, b) => a - b)
      .map((noteId) => {
        const note = noteById.get(noteId);
        if (!note) {
          throw new SeedDataError(`question_short_notes.json: question ${q.id}: unknown note`);
        }
        return note.title;
      });
    return {
      number,
      topic: topic.name,
      text: q.text,
      explanation: q.explanation,
      options: own.map((o) => ({ position: o.position, label: o.label })),
      correctPosition: first.position,
      noteTitles,
    };
  });

  const usedTopics = new Set(questions.map((q) => q.topic_id));
  const unusedTopics = topics
    .filter((t) => !usedTopics.has(t.id))
    .map((t) => `topics.json: topic ${t.id} has no questions and is not imported`);

  const skipped = report.skipped;
  return {
    data: { notes: notes.map((n) => ({ title: n.title, text: n.text })), questions: seedQuestions },
    summary: {
      notes: notes.length,
      questions: questions.length,
      questionBlocks: questions.length + skipped.length,
      skipped,
      warnings: [...report.warnings, ...unusedTopics],
    },
  };
}
