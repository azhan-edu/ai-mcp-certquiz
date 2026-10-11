// Part of the raw-data-to-json skill. Converts raw-data/*.md into JSON files that mirror the
// tables of src/db/schema.sql. Run from the project root:
//   npx tsx .claude/skills/raw-data-to-json/convert.mts [outDir]
// Reuses the parser in ./parser.ts (same skill). The output contains the answer key (options.json,
// is_correct): it is the input of `npm run db:seed` and must stay in the git-ignored raw-data/.
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { loadSeedData, SeedDataError } from "../../../src/db/seed-json.ts";
import { parseRawData } from "./parser.ts";

const root = process.cwd();
const rawDir = join(root, "raw-data");
const outDir = resolve(root, process.argv[2] ?? "raw-data/json");

function fail(message: string): never {
  throw new Error(message);
}

/** lstat that returns undefined when the path does not exist (a dangling symlink does exist). */
function lstatOrUndefined(path: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

/** A symlink on the outDir path whose target is missing: mkdir would fail or write elsewhere. */
function checkNoDanglingSymlink(dir: string): void {
  for (let p = dir; ; p = dirname(p)) {
    if (lstatOrUndefined(p)?.isSymbolicLink() && !existsSync(p)) {
      fail(`Refusing output directory ${dir}: dangling symlink ${p}`);
    }
    if (dirname(p) === p) return;
  }
}

/** The deepest existing ancestor is resolved through symlinks; the rest is appended as written. */
function realPathOf(path: string): string {
  let existing = path;
  while (!existsSync(existing)) existing = dirname(existing);
  return resolve(realpathSync(existing), relative(existing, path));
}

checkNoDanglingSymlink(outDir);

// The output holds the answer key (options.json): refuse anything outside <project root>/raw-data/.
const relativeOut = relative(realPathOf(rawDir), realPathOf(outDir));
if (
  relativeOut === "" ||
  relativeOut === ".." ||
  relativeOut.startsWith(`..${sep}`) ||
  isAbsolute(relativeOut)
) {
  fail(
    `Refusing output directory ${outDir}: it must be inside ${rawDir}/ (the output contains the answer key)`,
  );
}

const parsed = parseRawData(
  readFileSync(join(rawDir, "_shortNotes.md"), "utf8"),
  readFileSync(join(rawDir, "_shortNotesSource.md"), "utf8"),
);

// Ids are 1..n in source order, so the output is deterministic.
const topics = parsed.topics.map((name, i) => ({ id: i + 1, name }));
const topicId = new Map<string, number>(topics.map((t) => [t.name, t.id]));

const short_notes = parsed.notes.map((n, i) => ({
  id: i + 1,
  title: n.title,
  text: n.text,
}));
const noteId = new Map<string, number>(short_notes.map((n) => [n.title, n.id]));

type QuestionRow = { id: number; topic_id: number; text: string; explanation: string };
type OptionRow = {
  id: number;
  question_id: number;
  position: number;
  label: string;
  is_correct: 0 | 1;
};
const questions: QuestionRow[] = [];
const question_numbers: { id: number; number: number }[] = [];
const options: OptionRow[] = [];
const question_short_notes: { question_id: number; short_note_id: number }[] = [];
for (const q of parsed.questions) {
  const id = questions.length + 1;
  const topic_id = topicId.get(q.topic) ?? fail(`Q${q.number}: unknown topic`);
  questions.push({ id, topic_id, text: q.text, explanation: q.explanation });
  question_numbers.push({ id, number: q.number });
  for (const title of q.noteTitles) {
    const short_note_id = noteId.get(title) ?? fail(`Q${q.number}: unknown note`);
    question_short_notes.push({ question_id: id, short_note_id });
  }

  let correct = 0;
  for (const o of [...q.options].sort((a, b) => a.position - b.position)) {
    const is_correct: 0 | 1 = o.position === q.correctPosition ? 1 : 0;
    correct += is_correct;
    options.push({
      id: options.length + 1,
      question_id: id,
      position: o.position,
      label: o.label,
      is_correct,
    });
  }
  if (correct !== 1) fail(`Q${q.number}: expected exactly one correct option`);
}

question_short_notes.sort(
  (a, b) => a.question_id - b.question_id || a.short_note_id - b.short_note_id,
);

/** seed-json.ts caps reasons and warnings at 300 characters; longer text (long titles) is cut. */
const MAX_TEXT = 300;
const clip = (s: string): string => (s.length <= MAX_TEXT ? s : `${s.slice(0, MAX_TEXT - 1)}…`);
const skipped = parsed.skipped.map((s) => ({ number: s.number, reason: clip(s.reason) }));
const warnings = parsed.warnings.map(clip);

const report = {
  counts: {
    topics: topics.length,
    short_notes: short_notes.length,
    questions: questions.length,
    options: options.length,
    question_short_notes: question_short_notes.length,
  },
  skipped,
  warnings,
  // questions.json id -> source Qn, so that db:seed can report Qn numbers.
  question_numbers,
};

// Prove that the files fit the real schema: insert them into an in-memory database.
const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON");
db.exec(readFileSync(join(root, "src/db/schema.sql"), "utf8"));
function insert<T>(sql: string, rows: T[], values: (row: T) => (string | number)[]): void {
  const stmt = db.prepare(sql);
  for (const row of rows) stmt.run(...values(row));
}
insert("INSERT INTO topics (id, name) VALUES (?, ?)", topics, (r) => [r.id, r.name]);
insert("INSERT INTO short_notes (id, title, text) VALUES (?, ?, ?)", short_notes, (r) => [
  r.id,
  r.title,
  r.text,
]);
insert(
  "INSERT INTO questions (id, topic_id, text, explanation) VALUES (?, ?, ?, ?)",
  questions,
  (r) => [r.id, r.topic_id, r.text, r.explanation],
);
// The schema requires the correct option of a question to be inserted first; the files keep position order.
const correctFirst = [...options].sort(
  (a, b) => a.question_id - b.question_id || b.is_correct - a.is_correct || a.position - b.position,
);
insert(
  "INSERT INTO options (id, question_id, position, label, is_correct) VALUES (?, ?, ?, ?, ?)",
  correctFirst,
  (r) => [r.id, r.question_id, r.position, r.label, r.is_correct],
);
insert(
  "INSERT INTO question_short_notes (question_id, short_note_id) VALUES (?, ?)",
  question_short_notes,
  (r) => [r.question_id, r.short_note_id],
);
if (db.prepare("PRAGMA foreign_key_check").all().length > 0) fail("foreign_key_check failed");
db.close();

// Everything is built and checked in memory: files are written only after the scratch validation.
const outputs: [string, unknown][] = [
  ["topics.json", topics],
  ["short_notes.json", short_notes],
  ["questions.json", questions],
  ["options.json", options],
  ["question_short_notes.json", question_short_notes],
  ["_report.json", report],
];
const serialize = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

// Check all six targets first so a refusal leaves nothing written.
for (const [name] of outputs) {
  const target = join(outDir, name);
  if (lstatOrUndefined(target)?.isSymbolicLink()) {
    fail(`Refusing to write through a symlink: ${target}`);
  }
}

// Validate the exact file set with the reader of db:seed, in a scratch directory inside raw-data/
// (same guards as the output: it holds the answer key). Writer and reader cannot drift apart, and
// any SeedDataError aborts before the output directory is touched.
const tmpDir = join(rawDir, `.json-tmp-${process.pid}`);
checkNoDanglingSymlink(tmpDir);
if (lstatOrUndefined(tmpDir) !== undefined) {
  fail(
    `Refusing scratch directory ${tmpDir}: it exists. It is a leftover of an interrupted run and contains answer data; it may be deleted (rm -rf ${tmpDir})`,
  );
}
const relativeTmp = relative(realPathOf(rawDir), realPathOf(tmpDir));
if (relativeTmp.startsWith("..") || isAbsolute(relativeTmp) || relativeTmp === "") {
  fail(`Refusing scratch directory ${tmpDir}: it must be inside ${rawDir}/`);
}
// mkdirSync stays outside try/finally: only a directory created by this process is ever removed
// (EEXIST throws here and deletes nothing).
try {
  mkdirSync(tmpDir);
} catch (err) {
  if ((err as NodeJS.ErrnoException).code === "EEXIST") {
    fail(
      `Refusing scratch directory ${tmpDir}: it exists. It is a leftover of an interrupted run and contains answer data; it may be deleted (rm -rf ${tmpDir})`,
    );
  }
  throw err;
}
try {
  for (const [name, value] of outputs) writeFileSync(join(tmpDir, name), serialize(value));
  try {
    loadSeedData(tmpDir);
  } catch (err) {
    if (!(err instanceof SeedDataError)) throw err;
    // The reader names a local questions.json id; map it to the source Qn (never option data).
    const local = /\bquestion (\d+)\b|\bquestions\.json: id (\d+)\b/.exec(err.message);
    const localId = Number(local?.[1] ?? local?.[2]);
    const number = question_numbers.find((n) => n.id === localId)?.number;
    fail(number === undefined ? err.message : `${err.message} (Q${number})`);
  }
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}

mkdirSync(outDir, { recursive: true });
// _report.json is required by db:seed: remove the old one first and write the new one last, so an
// interrupted run leaves a set without a report, which db:seed rejects.
rmSync(join(outDir, "_report.json"), { force: true });
for (const [name, value] of outputs.filter(([n]) => n !== "_report.json")) {
  writeFileSync(join(outDir, name), serialize(value));
}
writeFileSync(join(outDir, "_report.json"), serialize(report));

const lines = [
  `JSON written to ${outDir}`,
  `topics: ${report.counts.topics}, short_notes: ${report.counts.short_notes}, questions: ${report.counts.questions}, options: ${report.counts.options}, question_short_notes: ${report.counts.question_short_notes}`,
  "schema check: all rows inserted into an in-memory database, foreign_key_check clean",
  `skipped ${parsed.skipped.length} of ${parsed.questionBlocks} questions:`,
  ...skipped.map((s) => `  Q${s.number}: ${s.reason}`),
  `warnings: ${warnings.length}`,
];
process.stdout.write(`${lines.join("\n")}\n`);
