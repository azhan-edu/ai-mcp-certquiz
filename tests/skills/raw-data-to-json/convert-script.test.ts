import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { makeConvertRoot, project, runConvert } from "./convert-layout.js";

// TEST DATA ONLY: synthetic fixtures, not real exam content.
// The script runs on import, so it is executed as a subprocess inside a temporary project layout.

const NOTES = `### Note one
- Test body of Note one.
- Вопросы: [Q1](x), [Q2](x)
`;
const SOURCE = `## 1. Alpha

### Q1
Заметки: [Note one](_shortNotes.md#L9999)

TEST question 1?

- A) MARKER-WRONG-1
- B) MARKER-RIGHT-1

**Ответ: B**

> Official: Correct. Explanation Q1.

### Q2
Заметки: —

TEST question 2?

- A) MARKER-WRONG-2
- B) MARKER-RIGHT-2

**Ответ: A**

> Official: Correct. Explanation Q2.
`;

const FILES = [
  "topics.json",
  "short_notes.json",
  "questions.json",
  "options.json",
  "question_short_notes.json",
  "_report.json",
];

describe("convert.mts output directory guard", () => {
  let root: string;
  let outside: string;

  beforeEach(() => {
    root = makeConvertRoot(NOTES, SOURCE);
    outside = mkdtempSync(join(tmpdir(), "certsafary-convert-out-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  const run = (...args: string[]) => runConvert(root, ...args);

  const readJson = (dir: string, name: string): unknown =>
    JSON.parse(readFileSync(join(dir, name), "utf8"));

  it("writes the six files to raw-data/json by default", () => {
    const result = run();
    expect(result.status).toBe(0);
    const out = join(root, "raw-data/json");
    for (const name of FILES) expect(existsSync(join(out, name))).toBe(true);

    expect(readJson(out, "_report.json")).toMatchObject({
      counts: { topics: 1, short_notes: 1, questions: 2, options: 4, question_short_notes: 2 },
    });
    expect(readJson(out, "question_short_notes.json")).toEqual([
      { question_id: 1, short_note_id: 1 },
      { question_id: 2, short_note_id: 1 },
    ]);
    expect(readFileSync(join(out, "questions.json"), "utf8")).not.toContain("short_note_id");
  });

  it("never prints a MARKER label or is_correct on stdout, and not in the report", () => {
    const result = run();
    expect(result.status).toBe(0);
    expect(result.stdout).not.toMatch(/MARKER|is_?correct/i);
    const report = readFileSync(join(root, "raw-data/json/_report.json"), "utf8");
    expect(report).not.toMatch(/MARKER|is_?correct/i);
  });

  it("writes question_numbers mapping every questions.json id to its source Qn", () => {
    expect(run().status).toBe(0);
    const out = join(root, "raw-data/json");
    expect(readJson(out, "_report.json")).toMatchObject({
      question_numbers: [
        { id: 1, number: 1 },
        { id: 2, number: 2 },
      ],
    });
  });

  it("question_numbers uses source numbers, not ids, when a question is skipped", () => {
    const skippedFirst = `## 1. Alpha

### Q4
Заметки: —

TEST open-ended question?

${SOURCE.slice(SOURCE.indexOf("### Q2"))}`;
    writeFileSync(join(root, "raw-data/_shortNotesSource.md"), skippedFirst);
    expect(run().status).toBe(0);
    const out = join(root, "raw-data/json");
    const report = readJson(out, "_report.json");
    expect(report).toMatchObject({
      skipped: [{ number: 4 }],
      question_numbers: [{ id: 1, number: 2 }],
    });
    expect(readJson(out, "questions.json")).toHaveLength(1);
  });

  it("question_numbers holds ids and numbers only: no option content", () => {
    expect(run().status).toBe(0);
    const report = readJson(join(root, "raw-data/json"), "_report.json");
    expect(report).toHaveProperty("question_numbers");
    const text = JSON.stringify(report);
    expect(text).not.toMatch(/MARKER|is_?correct/i);
    if (typeof report === "object" && report !== null && "question_numbers" in report) {
      const numbers = report.question_numbers;
      expect(Array.isArray(numbers)).toBe(true);
      if (Array.isArray(numbers)) {
        for (const entry of numbers) expect(Object.keys(entry).sort()).toEqual(["id", "number"]);
      }
    }
  });

  it("accepts a directory whose name merely starts with two dots", () => {
    expect(run("raw-data/..cache").status).toBe(0);
    expect(existsSync(join(root, "raw-data/..cache/questions.json"))).toBe(true);
  });

  it("accepts a subdirectory of raw-data/", () => {
    expect(run("raw-data/sub/deeper").status).toBe(0);
    expect(existsSync(join(root, "raw-data/sub/deeper/questions.json"))).toBe(true);
  });

  const refused = (args: string[], written: string) => {
    const result = run(...args);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Refusing output directory .*must be inside .*raw-data/);
    expect(existsSync(written)).toBe(false);
    for (const name of FILES) {
      expect(existsSync(join(root, "raw-data", name))).toBe(false);
      expect(existsSync(join(outside, name))).toBe(false);
    }
    expect(result.stdout + result.stderr).not.toMatch(/MARKER/);
  };

  it("refuses an output directory outside raw-data/", () => {
    refused([outside], join(outside, "options.json"));
    refused(["out"], join(root, "out"));
    refused(["."], join(root, "options.json"));
  });

  it("refuses raw-data/ itself", () => {
    refused(["raw-data"], join(root, "raw-data/options.json"));
    refused(["raw-data/"], join(root, "raw-data/options.json"));
  });

  it("refuses a .. escape out of raw-data/", () => {
    refused(["raw-data/../escaped"], join(root, "escaped"));
    refused(["raw-data/sub/../../escaped"], join(root, "escaped"));
  });

  it("refuses a symlink under raw-data/ that points outside", () => {
    symlinkSync(outside, join(root, "raw-data/link"));
    refused(["raw-data/link"], join(outside, "options.json"));
    refused(["raw-data/link/nested"], join(outside, "nested"));
  });

  describe("scratch validation and write order", () => {
    const json = () => join(root, "raw-data/json");
    const scratchDirs = () =>
      readdirSync(join(root, "raw-data")).filter((n) => n.startsWith(".json-tmp-"));
    const snapshot = (dir: string) =>
      Object.fromEntries(
        readdirSync(dir).map((name) => [name, readFileSync(join(dir, name), "utf8")]),
      );

    // The parser already skips every per-question violation that the db:seed reader would refuse,
    // so no markdown can reach the scratch check. To prove the scratch check aborts, the temporary
    // layout gets a reader that is stricter than the parser (writer and reader drifting apart:
    // a question needs at least 3 options). The original reader is unchanged.
    const stricterReader = () => {
      const path = join(root, "src/db/seed-json.ts");
      const original = readFileSync(path, "utf8");
      const stricter = original.replace("own.length < 2", "own.length < 3");
      expect(stricter).not.toBe(original);
      writeFileSync(path, stricter);
    };
    // Same questions under other source numbers, so the Qn differs from the local id.
    const RENUMBERED = SOURCE.replace("### Q1", "### Q7").replace("### Q2", "### Q9");

    it("leaves no .json-tmp-* directory behind after a successful run", () => {
      expect(run().status).toBe(0);
      expect(scratchDirs()).toEqual([]);
    });

    it("produces byte-identical output on two runs", () => {
      expect(run().status).toBe(0);
      const first = snapshot(json());
      expect(Object.keys(first).sort()).toEqual([...FILES].sort());
      expect(run().status).toBe(0);
      expect(snapshot(json())).toEqual(first);
    });

    it("the report written with the set covers every question id and the counts", () => {
      expect(run().status).toBe(0);
      const report = readJson(json(), "_report.json");
      expect(report).toMatchObject({
        counts: { questions: 2, options: 4 },
        question_numbers: [{ id: 1 }, { id: 2 }],
      });
    });

    it("a validation failure aborts: output dir untouched, scratch dir gone, no leak", () => {
      expect(run().status).toBe(0);
      const before = snapshot(json());

      writeFileSync(join(root, "raw-data/_shortNotesSource.md"), RENUMBERED);
      stricterReader();
      const result = run();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/question 1: fewer than 2 options \(Q7\)/);
      expect(result.stdout + result.stderr).not.toMatch(/MARKER/);
      expect(snapshot(json())).toEqual(before);
      expect(scratchDirs()).toEqual([]);
    });

    it("a validation failure on a first run creates no output directory", () => {
      writeFileSync(join(root, "raw-data/_shortNotesSource.md"), RENUMBERED);
      stricterReader();
      const result = run();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/\(Q7\)/);
      expect(result.stdout + result.stderr).not.toMatch(/MARKER|is_?correct/i);
      expect(existsSync(json())).toBe(false);
      expect(scratchDirs()).toEqual([]);
    });

    it("a question with duplicate option labels is skipped, not fatal", () => {
      const source = SOURCE.replace("MARKER-RIGHT-2", "MARKER-WRONG-2");
      writeFileSync(join(root, "raw-data/_shortNotesSource.md"), source);
      const result = run();
      expect(result.status).toBe(0);
      expect(result.stdout + result.stderr).not.toMatch(/MARKER|is_?correct/i);
      expect(readJson(json(), "questions.json")).toHaveLength(1);
      const report = readJson(json(), "_report.json");
      expect(report).toMatchObject({
        counts: { questions: 1, options: 2 },
        skipped: [{ number: 2, reason: "duplicate option labels" }],
        question_numbers: [{ id: 1, number: 1 }],
      });
      expect(JSON.stringify(report)).not.toMatch(/MARKER|is_?correct/i);
      expect(JSON.stringify(readJson(json(), "options.json"))).not.toContain("MARKER-WRONG-2");
      expect(scratchDirs()).toEqual([]);
    });

    it("does not touch a leftover scratch directory of another pid", () => {
      mkdirSync(join(root, "raw-data/.json-tmp-0"));
      expect(run().status).toBe(0);
      expect(existsSync(join(root, "raw-data/.json-tmp-0"))).toBe(true);
    });

    it("rewrites _report.json last: the old report is removed before the other files change", () => {
      expect(run().status).toBe(0);
      const out = json();
      // an old report that no longer matches; a failing write of any other file must not keep it
      writeFileSync(join(out, "_report.json"), "STALE");
      // a directory in place of questions.json makes writing it fail after the report was removed
      rmSync(join(out, "questions.json"));
      mkdirSync(join(out, "questions.json"));
      const result = run();
      expect(result.status).not.toBe(0);
      expect(existsSync(join(out, "_report.json"))).toBe(false);
    });

    it("the report is written after every data file: a failing last data file leaves no report", () => {
      expect(run().status).toBe(0);
      const out = json();
      // question_short_notes.json is the last data file written; a directory in its place fails it
      rmSync(join(out, "question_short_notes.json"));
      mkdirSync(join(out, "question_short_notes.json"));
      const result = run();
      expect(result.status).not.toBe(0);
      expect(existsSync(join(out, "_report.json"))).toBe(false);
    });

    describe("long text is truncated to 300 characters", () => {
      const LONG_TITLE = "T".repeat(400);
      // Note LONG_TITLE claims Q2 while Q2 does not link it: a long warning.
      // Q1 links a missing note: a short warning.
      const notes = `${NOTES}
### ${LONG_TITLE}
- Test body of the long note.
- Вопросы: [Q2](x)
`;
      const source = SOURCE.replace(
        "[Note one](_shortNotes.md#L9999)",
        "[Note one](_shortNotes.md#L9999), [Missing](_shortNotes.md#L9998)",
      );

      it("cuts a long warning to exactly 300 characters ending with an ellipsis", () => {
        const long = makeConvertRoot(notes, source);
        try {
          const result = runConvert(long);
          expect(result.status).toBe(0);
          const report = z
            .object({ warnings: z.array(z.string()) })
            .parse(JSON.parse(readFileSync(join(long, "raw-data/json/_report.json"), "utf8")));
          const cut = report.warnings.filter((w) => w.includes("TTTT"));
          expect(cut).toHaveLength(1);
          expect(cut[0]).toHaveLength(300);
          expect(cut[0]?.endsWith("…")).toBe(true);
          const short = report.warnings.filter((w) => w.includes("Missing"));
          expect(short).toHaveLength(1);
          expect(short[0]?.endsWith("…")).toBe(false);
          expect(short[0]).toContain('unresolved note link "Missing"');
          for (const line of result.stdout.split("\n"))
            expect(line.length).toBeLessThanOrEqual(300);
        } finally {
          rmSync(long, { recursive: true, force: true });
        }
      });
    });

    describe("leftover scratch directory", () => {
      const FAKE_PID = 424242;

      it("refuses an existing .json-tmp-<pid>, naming it and leaving it and the output alone", () => {
        const preload = join(root, "fake-pid.mjs");
        writeFileSync(
          preload,
          `Object.defineProperty(process, "pid", { value: ${FAKE_PID}, configurable: true });\n`,
        );
        const leftover = join(root, `raw-data/.json-tmp-${FAKE_PID}`);
        mkdirSync(leftover);
        writeFileSync(join(leftover, "keep.txt"), "TEST leftover");

        const tsx = pathToFileURL(join(project, "node_modules/tsx/dist/esm/index.mjs")).href;
        const result = spawnSync(
          process.execPath,
          [
            "--import",
            pathToFileURL(preload).href,
            "--import",
            tsx,
            ".claude/skills/raw-data-to-json/convert.mts",
          ],
          { cwd: root, encoding: "utf8", timeout: 60_000 },
        );
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(`.json-tmp-${FAKE_PID}`);
        expect(result.stderr).toContain(`rm -rf`);
        expect(result.stderr).toMatch(/interrupted run/);
        expect(readFileSync(join(leftover, "keep.txt"), "utf8")).toBe("TEST leftover");
        expect(readdirSync(leftover)).toEqual(["keep.txt"]);
        expect(existsSync(json())).toBe(false);
        expect(result.stdout + result.stderr).not.toMatch(/MARKER/);
      });
    });
  });

  describe("symlinks", () => {
    const untouched = (dir: string) => {
      for (const name of FILES) expect(existsSync(join(dir, name))).toBe(false);
    };

    it("refuses a pre-created symlink target, writing none of the six files", () => {
      const victim = join(outside, "victim.txt");
      writeFileSync(victim, "TEST victim content");
      const json = join(root, "raw-data/json");
      mkdirSync(json);
      symlinkSync(victim, join(json, "options.json"));

      const result = run();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/Refusing to write through a symlink: .*options\.json/);
      expect(readFileSync(victim, "utf8")).toBe("TEST victim content");
      for (const name of FILES.filter((f) => f !== "options.json")) {
        expect(existsSync(join(json, name))).toBe(false);
      }
      untouched(join(root, "raw-data"));
      expect(readdirSync(outside)).toEqual(["victim.txt"]);
      expect(result.stdout + result.stderr).not.toMatch(/MARKER/);
    });

    it("refuses a symlink chain that goes inside raw-data/ and then out", () => {
      const victim = join(outside, "victim.txt");
      writeFileSync(victim, "TEST victim content");
      symlinkSync(victim, join(root, "raw-data/hop"));
      const json = join(root, "raw-data/json");
      mkdirSync(json);
      symlinkSync(join(root, "raw-data/hop"), join(json, "questions.json"));

      const result = run();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/Refusing to write through a symlink: .*questions\.json/);
      expect(readFileSync(victim, "utf8")).toBe("TEST victim content");
      for (const name of FILES)
        expect(existsSync(join(json, name))).toBe(name === "questions.json");
      expect(readdirSync(outside)).toEqual(["victim.txt"]);
    });

    it("refuses an output directory that is a dangling symlink", () => {
      const missing = join(outside, "missing-dir");
      symlinkSync(missing, join(root, "raw-data/dangling"));

      for (const arg of ["raw-data/dangling", "raw-data/dangling/nested"]) {
        const result = run(arg);
        expect(result.status).not.toBe(0);
        expect(result.stderr).toMatch(/Refusing output directory .*: dangling symlink .*dangling/);
        expect(existsSync(missing)).toBe(false);
        expect(readdirSync(outside)).toEqual([]);
        untouched(join(root, "raw-data"));
      }
    });
  });
});
