import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applySchema, DatabaseError, openDatabase } from "../../src/db/connection.js";
import { importSeedData } from "../../src/db/import.js";
import { buildFixture, seedData } from "../helpers/seed-json.js";

describe("openDatabase", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "certquiz-test-"));
    path = join(dir, "nested", "test.db");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("read-only open of a missing file points to db:seed and creates nothing", () => {
    expect(() => openDatabase(path, { readOnly: true })).toThrow(DatabaseError);
    expect(() => openDatabase(path, { readOnly: true })).toThrow(/db:seed/);
    expect(existsSync(path)).toBe(false);
    expect(existsSync(dirname(path))).toBe(false);
  });

  it("read-only open of a file without schema points to db:seed", () => {
    openDatabase(path).close();
    expect(() => openDatabase(path, { readOnly: true })).toThrow(/no schema.*db:seed/);
  });

  it("read-only open rejects a file that is not a SQLite database and a file with only some tables", () => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "this is not a database, just text padding ".repeat(50));
    expect(() => openDatabase(path, { readOnly: true })).toThrow(DatabaseError);
    expect(() => openDatabase(path, { readOnly: true })).toThrow(/not a SQLite database.*db:seed/);
    rmSync(path);

    const partial = new DatabaseSync(path);
    partial.exec("CREATE TABLE topics (id INTEGER PRIMARY KEY, name TEXT)");
    partial.close();
    expect(() => openDatabase(path, { readOnly: true })).toThrow(/no schema.*db:seed/);
  });

  it("creates the directory, applies the schema in WAL mode, and opens read-only afterwards", () => {
    const writer = openDatabase(path);
    applySchema(writer);
    const mode = writer.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
    expect(mode.journal_mode).toBe("wal");
    writer.close();

    const reader = openDatabase(path, { readOnly: true });
    expect(() => reader.exec("INSERT INTO topics (name) VALUES ('x')")).toThrow();
    reader.close();
  });

  it("wal: false leaves the journal mode of an existing file alone", () => {
    const first = new DatabaseSync(path.replace("nested/", ""));
    first.close();
    const plain = openDatabase(path.replace("nested/", ""), { wal: false });
    const mode = plain.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
    expect(mode.journal_mode).not.toBe("wal");
    plain.close();
  });
});

describe("importSeedData on a file database", () => {
  it("a dry run leaves the data and the schema of an existing file untouched", () => {
    const dir = mkdtempSync(join(tmpdir(), "certquiz-test-"));
    try {
      const path = join(dir, "t.db");
      const db = openDatabase(path);
      importSeedData(db, seedData(buildFixture({ questions: [] })));
      const before = db.prepare("SELECT COUNT(*) AS n FROM topics").get();
      const data = seedData(
        buildFixture({ notes: ["N"], questions: [{ text: "TEST?", notes: ["N"] }] }),
      );
      const report = importSeedData(db, data, { dryRun: true });
      expect(report.inserted.questions).toBe(1);
      expect(db.prepare("SELECT COUNT(*) AS n FROM topics").get()).toEqual(before);
      expect(db.prepare("SELECT COUNT(*) AS n FROM questions").get()).toEqual({ n: 0 });
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("schema constraints", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    applySchema(db);
    db.exec(
      "INSERT INTO topics (id, name) VALUES (1, 'TEST topic'); INSERT INTO questions (id, topic_id, text, explanation) VALUES (1, 1, 'TEST q1', 'e'), (2, 1, 'TEST q2', 'e'); INSERT INTO short_notes (id, title, text) VALUES (1, 'TEST n1', 'body'), (2, 'TEST n2', 'body')",
    );
  });
  afterEach(() => db.close());

  // The correct option of a question must be inserted first (trigger), so the position CHECK is
  // tested on a correct option, and on an incorrect one inserted after it.
  const addOption = (position: number, isCorrect = 1, questionId = 1) =>
    db.exec(
      `INSERT INTO options (question_id, position, label, is_correct) VALUES (${questionId}, ${position}, 'TEST label', ${isCorrect})`,
    );
  const links = () =>
    db
      .prepare(
        "SELECT question_id AS q, short_note_id AS n FROM question_short_notes ORDER BY 1, 2",
      )
      .all()
      .map((r) => `${String(r.q)}-${String(r.n)}`);

  describe("options.position", () => {
    it.each([0, -1, -100])("rejects position %i on the correct option", (position) => {
      expect(() => addOption(position, 1)).toThrow(/CHECK constraint failed/);
      expect(db.prepare("SELECT COUNT(*) AS n FROM options").get()).toEqual({ n: 0 });
    });

    it.each([0, -1, -100])(
      "rejects position %i on an incorrect option after the correct one",
      (position) => {
        addOption(1, 1);
        expect(() => addOption(position, 0)).toThrow(/CHECK constraint failed/);
        expect(db.prepare("SELECT COUNT(*) AS n FROM options").get()).toEqual({ n: 1 });
      },
    );

    it("accepts position 1 on the correct option", () => {
      addOption(1, 1);
      expect(db.prepare("SELECT COUNT(*) AS n FROM options").get()).toEqual({ n: 1 });
    });

    it("accepts position 1 on an incorrect option after the correct one", () => {
      addOption(2, 1);
      addOption(1, 0);
      expect(db.prepare("SELECT COUNT(*) AS n FROM options").get()).toEqual({ n: 2 });
    });
  });

  describe("question_short_notes", () => {
    it("is a WITHOUT ROWID table", () => {
      expect(
        db.prepare("SELECT wr FROM pragma_table_list WHERE name = 'question_short_notes'").get(),
      ).toEqual({ wr: 1 });
    });

    it("the primary key rejects a duplicate pair but allows distinct pairs", () => {
      db.exec("INSERT INTO question_short_notes VALUES (1, 1), (1, 2), (2, 1)");
      expect(() => db.exec("INSERT INTO question_short_notes VALUES (1, 1)")).toThrow(
        /constraint/i,
      );
      expect(links()).toEqual(["1-1", "1-2", "2-1"]);
    });

    it("INSERT OR IGNORE ignores a duplicate pair", () => {
      db.exec("INSERT INTO question_short_notes VALUES (1, 1)");
      db.exec("INSERT OR IGNORE INTO question_short_notes VALUES (1, 1)");
      expect(links()).toEqual(["1-1"]);
    });

    it("deleting a question cascades to its links and keeps the notes", () => {
      db.exec("INSERT INTO question_short_notes VALUES (1, 1), (2, 1)");
      db.exec("DELETE FROM questions WHERE id = 1");
      expect(links()).toEqual(["2-1"]);
      expect(db.prepare("SELECT COUNT(*) AS n FROM short_notes").get()).toEqual({ n: 2 });
    });

    it("deleting a note cascades to its links and keeps the questions", () => {
      db.exec("INSERT INTO question_short_notes VALUES (1, 1), (1, 2)");
      db.exec("DELETE FROM short_notes WHERE id = 1");
      expect(links()).toEqual(["1-2"]);
      expect(db.prepare("SELECT COUNT(*) AS n FROM questions").get()).toEqual({ n: 2 });
    });
  });
});

describe("exactly one correct option (database level)", () => {
  // TEST DATA ONLY. Labels carry a MARKER that must never appear in an error message.
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    applySchema(db);
    db.exec(
      "INSERT INTO topics (id, name) VALUES (1, 'TEST topic A'), (2, 'TEST topic B'); INSERT INTO questions (id, topic_id, text, explanation) VALUES (1, 1, 'TEST q1', 'e'), (2, 1, 'TEST q2', 'e')",
    );
  });
  afterEach(() => db.close());

  const add = (question: number, position: number, correct: boolean) =>
    db
      .prepare("INSERT INTO options (question_id, position, label, is_correct) VALUES (?, ?, ?, ?)")
      .run(question, position, `MARKER-${question}-${position}`, correct ? 1 : 0);
  const optionId = (question: number, position: number): number =>
    Number(
      db
        .prepare("SELECT id FROM options WHERE question_id = ? AND position = ?")
        .get(question, position)?.id,
    );
  const optionCount = (question?: number): number =>
    Number(
      (question === undefined
        ? db.prepare("SELECT COUNT(*) AS n FROM options").get()
        : db.prepare("SELECT COUNT(*) AS n FROM options WHERE question_id = ?").get(question)
      )?.n,
    );
  const errorOf = (fn: () => unknown): Error => {
    try {
      fn();
    } catch (err) {
      if (err instanceof Error) return err;
    }
    throw new Error("expected the statement to fail");
  };
  const seedQuestion1 = () => {
    add(1, 2, true);
    add(1, 1, false);
    add(1, 3, false);
  };

  it("refuses an incorrect option as the first option of a question", () => {
    const err = errorOf(() => add(1, 1, false));
    expect(err.message).toMatch(/correct option of a question must be inserted first/);
    expect(err.message).not.toMatch(/MARKER/);
    expect(optionCount()).toBe(0);
  });

  it("accepts the correct option first and incorrect ones after it", () => {
    seedQuestion1();
    expect(optionCount(1)).toBe(3);
  });

  it("applies the first-option rule per question", () => {
    add(1, 1, true);
    expect(() => add(2, 1, false)).toThrow(/must be inserted first/);
    add(2, 1, true);
    add(2, 2, false);
    expect(optionCount(2)).toBe(2);
  });

  it("refuses a second correct option (options_no_replace trigger)", () => {
    add(1, 1, true);
    const err = errorOf(() => add(1, 2, true));
    expect(err.message).toMatch(/an option cannot replace or duplicate an existing option/);
    expect(err.message).not.toMatch(/MARKER/);
    expect(optionCount(1)).toBe(1);
  });

  it("keeps the partial unique index one_correct_per_question", () => {
    const row = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?")
      .get("one_correct_per_question");
    expect(row).toBeDefined();
    expect(String(row?.sql)).toMatch(/UNIQUE INDEX/i);
    expect(String(row?.sql)).toMatch(/WHERE is_correct = 1/i);
  });

  it("refuses to unmark the correct option", () => {
    seedQuestion1();
    const err = errorOf(() => db.exec("UPDATE options SET is_correct = 0 WHERE is_correct = 1"));
    expect(err.message).toMatch(/the correctness flag of an option cannot be changed/);
    expect(err.message).not.toMatch(/MARKER/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM options WHERE is_correct = 1").get()).toEqual({
      n: 1,
    });
  });

  it("refuses to mark an incorrect option as correct while a correct one exists", () => {
    seedQuestion1();
    const err = errorOf(() => db.exec("UPDATE options SET is_correct = 1 WHERE position = 1"));
    expect(err.message).toMatch(/the correctness flag of an option cannot be changed/);
    expect(err.message).not.toMatch(/MARKER/);
    expect(db.prepare("SELECT is_correct AS c FROM options WHERE position = 1").get()).toEqual({
      c: 0,
    });
  });

  it("refuses to move an option to another question", () => {
    seedQuestion1();
    add(2, 1, true);
    const err = errorOf(() =>
      db.prepare("UPDATE options SET question_id = 2 WHERE id = ?").run(optionId(1, 1)),
    );
    expect(err.message).toMatch(/option cannot be moved to another question/);
    expect(err.message).not.toMatch(/MARKER/);
    expect(optionCount(1)).toBe(3);
    expect(optionCount(2)).toBe(1);
  });

  it("refuses to delete the correct option while its question exists", () => {
    seedQuestion1();
    const err = errorOf(() => db.exec("DELETE FROM options WHERE is_correct = 1"));
    expect(err.message).toMatch(/correct option of a question cannot be deleted/);
    expect(err.message).not.toMatch(/MARKER/);
    expect(optionCount(1)).toBe(3);
  });

  it("allows deleting an incorrect option", () => {
    seedQuestion1();
    db.prepare("DELETE FROM options WHERE id = ?").run(optionId(1, 1));
    expect(optionCount(1)).toBe(2);
    expect(db.prepare("SELECT COUNT(*) AS n FROM options WHERE is_correct = 1").get()).toEqual({
      n: 1,
    });
  });

  it("deleting a question cascades all its options, the correct one included, and only those", () => {
    seedQuestion1();
    add(2, 1, true);
    add(2, 2, false);
    db.exec("DELETE FROM questions WHERE id = 1");
    expect(optionCount(1)).toBe(0);
    expect(optionCount(2)).toBe(2);
    expect(db.prepare("SELECT COUNT(*) AS n FROM options WHERE is_correct = 1").get()).toEqual({
      n: 1,
    });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("a topic that still has questions cannot be deleted (RESTRICT)", () => {
    expect(() => db.exec("DELETE FROM topics WHERE id = 1")).toThrow(
      /FOREIGN KEY constraint failed/,
    );
    expect(db.prepare("SELECT COUNT(*) AS n FROM topics").get()).toEqual({ n: 2 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM questions").get()).toEqual({ n: 2 });
  });

  it("a topic without questions can be deleted", () => {
    db.exec("DELETE FROM topics WHERE id = 2");
    expect(db.prepare("SELECT COUNT(*) AS n FROM topics").get()).toEqual({ n: 1 });
  });

  it("has no idx_questions_topic, and the UNIQUE (topic_id, text) autoindex serves topic lookups", () => {
    const named = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_questions_topic'",
      )
      .all();
    expect(named).toEqual([]);
    const unique = db
      .prepare(
        "SELECT name FROM pragma_index_list('questions') WHERE \"unique\" = 1 AND origin = 'u'",
      )
      .all()
      .map((r) => String(r.name));
    expect(unique).toHaveLength(1);
    const columns = db
      .prepare("SELECT name FROM pragma_index_info(?) ORDER BY seqno")
      .all(unique[0] ?? "")
      .map((r) => String(r.name));
    expect(columns).toEqual(["topic_id", "text"]);
  });

  it("KNOWN GAP: the schema cannot forbid a question with zero options", () => {
    // Documented in schema.sql; seed-json validation and the import guard against it instead.
    const orphan = db.prepare("SELECT COUNT(*) AS n FROM options WHERE question_id = 2").get();
    expect(orphan).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM questions WHERE id = 2").get()).toEqual({ n: 1 });
  });
});

describe("option and question triggers: REPLACE and key bypasses", () => {
  // TEST DATA ONLY. Labels carry a MARKER that must never appear in an error message.
  const NO_REPLACE = /an option cannot replace or duplicate an existing option/;
  const KEY_UPDATE = /the id and position of an option cannot be changed/;
  const FLAG_UPDATE = /the correctness flag of an option cannot be changed/;
  const Q_NO_REPLACE = /a question cannot replace or duplicate an existing question/;
  const TRIGGERS = [
    "options_correct_delete",
    "options_correct_first",
    "options_correct_update",
    "options_key_update",
    "options_no_move",
    "options_no_replace",
    "questions_no_replace",
    "questions_no_replace_update",
  ];

  let db: DatabaseSync;

  const add = (question: number, position: number, correct: boolean, id?: number) =>
    db
      .prepare(
        "INSERT INTO options (id, question_id, position, label, is_correct) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id ?? null, question, position, `MARKER-${question}-${position}`, correct ? 1 : 0);

  const snapshot = (): string =>
    JSON.stringify({
      options: db
        .prepare("SELECT id, question_id, position, label, is_correct FROM options ORDER BY id")
        .all(),
      questions: db
        .prepare("SELECT id, topic_id, text, explanation FROM questions ORDER BY id")
        .all(),
    });
  const correctCounts = (): unknown[] =>
    db
      .prepare(
        "SELECT question_id AS q, COUNT(*) AS n FROM options WHERE is_correct = 1 GROUP BY question_id ORDER BY 1",
      )
      .all()
      .map((r) => `${String(r.q)}:${String(r.n)}`);
  const triggerNames = (): string[] =>
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name")
      .all()
      .map((r) => String(r.name));

  // Runs a statement that must abort with the given message and leave every row untouched.
  const expectAborts = (sql: string, message: RegExp) => {
    const before = snapshot();
    const countsBefore = correctCounts();
    let error: Error | undefined;
    try {
      db.exec(sql);
    } catch (err) {
      if (err instanceof Error) error = err;
    }
    expect(error, `expected to abort: ${sql}`).toBeDefined();
    expect(error?.message).toMatch(message);
    expect(error?.message).not.toMatch(/MARKER/);
    expect(snapshot()).toBe(before);
    expect(correctCounts()).toEqual(countsBefore);
  };

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    applySchema(db);
    db.exec(
      "INSERT INTO topics (id, name) VALUES (1, 'TEST topic A'), (2, 'TEST topic B'); INSERT INTO questions (id, topic_id, text, explanation) VALUES (1, 1, 'TEST q1', 'e1'), (2, 1, 'TEST q2', 'e2')",
    );
    // question 1: ids 1..3, correct option at position 2 (id 1); question 2: ids 4..5
    add(1, 2, true);
    add(1, 1, false);
    add(1, 3, false);
    add(2, 1, true);
    add(2, 2, false);
  });
  afterEach(() => db.close());

  const insertOr = (verb: string, tail: string) =>
    `INSERT${verb} INTO options (question_id, position, label, is_correct) VALUES ${tail}`;

  describe("options inserts", () => {
    it("A: INSERT OR REPLACE over the position of the correct option aborts", () => {
      expectAborts(insertOr(" OR REPLACE", "(1, 2, 'MARKER-new', 0)"), NO_REPLACE);
      expectAborts(insertOr(" OR REPLACE", "(1, 2, 'MARKER-new', 1)"), NO_REPLACE);
    });

    it("A: the plain INSERT shape aborts too", () => {
      expectAborts(insertOr("", "(1, 2, 'MARKER-new', 0)"), NO_REPLACE);
    });

    it("F: INSERT OR REPLACE with is_correct NULL cannot make the first option incorrect", () => {
      // REPLACE would turn the NULL into the column default 0 after the triggers ran
      db.exec(
        "INSERT INTO questions (id, topic_id, text, explanation) VALUES (3, 1, 'TEST q3', 'e3')",
      );
      expectAborts(
        insertOr(" OR REPLACE", "(3, 1, 'MARKER-new', NULL)"),
        /correct option of a question must be inserted first/,
      );
      // the BEFORE trigger answers before the NOT NULL check, so a plain INSERT gets the same message
      expectAborts(
        insertOr("", "(3, 1, 'MARKER-new', NULL)"),
        /correct option of a question must be inserted first/,
      );
      expectAborts(
        "INSERT OR REPLACE INTO options (question_id, position, label) VALUES (3, 1, 'MARKER-new')",
        /correct option of a question must be inserted first/,
      );
      expect(db.prepare("SELECT COUNT(*) AS n FROM options WHERE question_id = 3").get()).toEqual({
        n: 0,
      });
    });

    it("A2: INSERT OR REPLACE reusing the id of the correct option aborts", () => {
      expectAborts(
        "INSERT OR REPLACE INTO options (id, question_id, position, label, is_correct) VALUES (1, 1, 9, 'MARKER-new', 0)",
        NO_REPLACE,
      );
      expectAborts(
        "INSERT OR REPLACE INTO options (id, question_id, position, label, is_correct) VALUES (1, 2, 9, 'MARKER-new', 0)",
        NO_REPLACE,
      );
    });

    it("C: INSERT OR REPLACE with is_correct = 1 on a question that has a correct option aborts", () => {
      expectAborts(insertOr(" OR REPLACE", "(1, 9, 'MARKER-new', 1)"), NO_REPLACE);
    });

    it("C: the plain INSERT shape aborts too", () => {
      expectAborts(insertOr("", "(1, 9, 'MARKER-new', 1)"), NO_REPLACE);
    });

    it("a plain INSERT with a duplicate (question_id, position) aborts with the trigger message", () => {
      expectAborts(insertOr("", "(1, 1, 'MARKER-new', 0)"), NO_REPLACE);
    });
  });

  describe("options updates", () => {
    it("B: UPDATE OR REPLACE of a position onto the correct option's position aborts", () => {
      expectAborts("UPDATE OR REPLACE options SET position = 2 WHERE id = 2", KEY_UPDATE);
      expectAborts("UPDATE OR REPLACE options SET position = 2 WHERE id = 3", KEY_UPDATE);
    });

    it("C2: UPDATE OR REPLACE SET is_correct = 1 on another option aborts", () => {
      expectAborts("UPDATE OR REPLACE options SET is_correct = 1 WHERE id = 2", FLAG_UPDATE);
    });

    it("D: changing the id of the correct option aborts", () => {
      expectAborts(
        "UPDATE options SET id = 50 WHERE is_correct = 1 AND question_id = 1",
        KEY_UPDATE,
      );
      expectAborts(
        "UPDATE OR REPLACE options SET id = 50 WHERE is_correct = 1 AND question_id = 1",
        KEY_UPDATE,
      );
    });

    it("D: changing the position of any option aborts", () => {
      expectAborts("UPDATE options SET position = 7 WHERE id = 1", KEY_UPDATE);
      expectAborts("UPDATE options SET position = 7 WHERE id = 2", KEY_UPDATE);
      expectAborts("UPDATE options SET position = position + 10", KEY_UPDATE);
    });
  });

  describe("questions", () => {
    it("E: INSERT OR REPLACE with an existing id aborts and the old question keeps its options", () => {
      expectAborts(
        "INSERT OR REPLACE INTO questions (id, topic_id, text, explanation) VALUES (1, 2, 'MARKER-other', 'x')",
        Q_NO_REPLACE,
      );
      expect(db.prepare("SELECT COUNT(*) AS n FROM options WHERE question_id = 1").get()).toEqual({
        n: 3,
      });
    });

    it("E: INSERT OR REPLACE with an existing (topic_id, text) aborts and the old question keeps its options", () => {
      expectAborts(
        "INSERT OR REPLACE INTO questions (id, topic_id, text, explanation) VALUES (77, 1, 'TEST q1', 'x')",
        Q_NO_REPLACE,
      );
      expectAborts(
        "INSERT OR REPLACE INTO questions (topic_id, text, explanation) VALUES (1, 'TEST q1', 'x')",
        Q_NO_REPLACE,
      );
      expect(db.prepare("SELECT COUNT(*) AS n FROM options WHERE question_id = 1").get()).toEqual({
        n: 3,
      });
    });

    it("E: the plain INSERT shapes abort too", () => {
      expectAborts(
        "INSERT INTO questions (id, topic_id, text, explanation) VALUES (1, 2, 'MARKER-other', 'x')",
        Q_NO_REPLACE,
      );
      expectAborts(
        "INSERT INTO questions (topic_id, text, explanation) VALUES (1, 'TEST q1', 'x')",
        Q_NO_REPLACE,
      );
    });

    it("E2: UPDATE OR REPLACE of text or id colliding with another question aborts", () => {
      expectAborts("UPDATE OR REPLACE questions SET text = 'TEST q2' WHERE id = 1", Q_NO_REPLACE);
      expectAborts("UPDATE OR REPLACE questions SET id = 2 WHERE id = 1", Q_NO_REPLACE);
      expectAborts("UPDATE questions SET id = 2 WHERE id = 1", Q_NO_REPLACE);
    });

    it("the same text is allowed in another topic", () => {
      db.exec("INSERT INTO questions (topic_id, text, explanation) VALUES (2, 'TEST q1', 'x')");
      expect(db.prepare("SELECT COUNT(*) AS n FROM questions").get()).toEqual({ n: 3 });
    });
  });

  describe("normal flows still work", () => {
    it("inserts the correct option first, then the others with explicit ids", () => {
      db.exec(
        "INSERT INTO questions (id, topic_id, text, explanation) VALUES (3, 2, 'TEST q3', 'e')",
      );
      add(3, 3, true, 30);
      add(3, 1, false, 31);
      add(3, 2, false, 32);
      expect(db.prepare("SELECT id FROM options WHERE question_id = 3 ORDER BY id").all()).toEqual([
        { id: 30 },
        { id: 31 },
        { id: 32 },
      ]);
      expect(correctCounts()).toEqual(["1:1", "2:1", "3:1"]);
    });

    it("updates a label", () => {
      db.exec("UPDATE options SET label = 'MARKER-renamed' WHERE id = 2");
      expect(db.prepare("SELECT label FROM options WHERE id = 2").get()).toEqual({
        label: "MARKER-renamed",
      });
      expect(correctCounts()).toEqual(["1:1", "2:1"]);
    });

    it("updates the explanation and text of a question without colliding", () => {
      db.exec("UPDATE questions SET explanation = 'changed' WHERE id = 1");
      db.exec("UPDATE questions SET text = 'TEST q1 renamed' WHERE id = 1");
      db.exec("UPDATE questions SET text = text WHERE id = 2");
      expect(db.prepare("SELECT explanation FROM questions WHERE id = 1").get()).toEqual({
        explanation: "changed",
      });
      expect(db.prepare("SELECT COUNT(*) AS n FROM options WHERE question_id = 1").get()).toEqual({
        n: 3,
      });
    });

    it("deletes a wrong option", () => {
      db.exec("DELETE FROM options WHERE id = 2");
      expect(db.prepare("SELECT COUNT(*) AS n FROM options WHERE question_id = 1").get()).toEqual({
        n: 2,
      });
      expect(correctCounts()).toEqual(["1:1", "2:1"]);
    });

    it("deleting a question cascades its options", () => {
      db.exec("DELETE FROM questions WHERE id = 1");
      expect(db.prepare("SELECT COUNT(*) AS n FROM options WHERE question_id = 1").get()).toEqual({
        n: 0,
      });
      expect(correctCounts()).toEqual(["2:1"]);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    });
  });

  describe("applySchema", () => {
    it("declares exactly the expected triggers", () => {
      expect(triggerNames()).toEqual(TRIGGERS);
    });

    it("is idempotent: running it again leaves the same triggers and data", () => {
      const before = snapshot();
      const master = db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY name").all();
      applySchema(db);
      applySchema(db);
      expect(triggerNames()).toEqual(TRIGGERS);
      expect(db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY name").all()).toEqual(
        master,
      );
      expect(snapshot()).toBe(before);
    });

    it("refreshes a weakened trigger on an existing database", () => {
      db.exec("DROP TRIGGER options_no_replace");
      db.exec("CREATE TRIGGER options_no_replace BEFORE INSERT ON options BEGIN SELECT 1; END");
      applySchema(db);
      expectAborts(insertOr(" OR REPLACE", "(1, 2, 'MARKER-new', 0)"), NO_REPLACE);
      expect(triggerNames()).toEqual(TRIGGERS);
    });

    it("restores a trigger that was dropped from an existing database", () => {
      db.exec("DROP TRIGGER questions_no_replace");
      applySchema(db);
      expect(triggerNames()).toEqual(TRIGGERS);
      expectAborts(
        "INSERT OR REPLACE INTO questions (id, topic_id, text, explanation) VALUES (1, 2, 'MARKER-other', 'x')",
        Q_NO_REPLACE,
      );
    });
  });
});
