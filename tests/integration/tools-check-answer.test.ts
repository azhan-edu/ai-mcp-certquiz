import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMcpHarness, LEAK, questionId, textOf } from "../helpers/mcp.js";
import { richFixture } from "../helpers/seed-json.js";

// TEST DATA ONLY: synthetic fixtures, not real exam content.

const loggerError = vi.hoisted(() => vi.fn());
vi.mock("../../src/lib/logger.js", () => ({
  createLogger: () => ({
    error: loggerError,
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe("tool check_answer", () => {
  const h = createMcpHarness();

  afterEach(async () => {
    await h.dispose();
    loggerError.mockClear();
  });

  const { withDb } = h;

  const internalError = (args: Record<string, unknown>) =>
    h.expectInternalError("check_answer", args, loggerError);

  const optionId = (db: DatabaseSync, label: string): number =>
    Number((db.prepare("SELECT id FROM options WHERE label = ?").get(label) as { id: number }).id);

  const correctId = (db: DatabaseSync, qid: number): number =>
    Number(
      (
        db.prepare("SELECT id FROM options WHERE question_id = ? AND is_correct = 1").get(qid) as {
          id: number;
        }
      ).id,
    );

  it("correct option: correct is true, shapes mirrored in structuredContent and text", async () => {
    const { client, db } = await withDb(richFixture());
    const qid = questionId(db, "TEST question 1?");
    const oid = correctId(db, qid);
    const result = await client.callTool({
      name: "check_answer",
      arguments: { questionId: qid, optionId: oid },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ correct: true, correctOptionId: oid });
    expect(JSON.parse(textOf(result))).toEqual(result.structuredContent);
  });

  it("incorrect option: correct is false and the correct option id is still returned", async () => {
    const { client, db } = await withDb(richFixture());
    const qid = questionId(db, "TEST question 1?");
    const wrong = optionId(db, "MARKER-1A");
    const result = await client.callTool({
      name: "check_answer",
      arguments: { questionId: qid, optionId: wrong },
    });
    expect(result.isError).toBeFalsy();
    expect(wrong).not.toBe(correctId(db, qid));
    expect(result.structuredContent).toEqual({
      correct: false,
      correctOptionId: correctId(db, qid),
    });
    expect(JSON.parse(textOf(result))).toEqual(result.structuredContent);
  });

  it("distinguishes every option of every question", async () => {
    const { client, db } = await withDb(richFixture());
    const rows = db.prepare("SELECT id, question_id, is_correct FROM options").all() as {
      id: number;
      question_id: number;
      is_correct: number;
    }[];
    expect(rows.length).toBe(5);
    for (const row of rows) {
      const result = await client.callTool({
        name: "check_answer",
        arguments: { questionId: Number(row.question_id), optionId: Number(row.id) },
      });
      expect((result.structuredContent as { correct: boolean }).correct).toBe(
        Number(row.is_correct) === 1,
      );
    }
  });

  it("option of another question gives a short isError", async () => {
    const { client, db } = await withDb(richFixture());
    const q1 = questionId(db, "TEST question 1?");
    const foreign = optionId(db, "MARKER-2A");
    const result = await client.callTool({
      name: "check_answer",
      arguments: { questionId: q1, optionId: foreign },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(`Option ${foreign} not found for question ${q1}`);
    expect(JSON.stringify(result)).not.toMatch(LEAK);
  });

  it("unknown option gives a short isError", async () => {
    const { client, db } = await withDb(richFixture());
    const q1 = questionId(db, "TEST question 1?");
    const result = await client.callTool({
      name: "check_answer",
      arguments: { questionId: q1, optionId: 999 },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(`Option 999 not found for question ${q1}`);
    expect(result.structuredContent).toBeUndefined();
  });

  it("unknown question gives a short isError", async () => {
    const { client } = await withDb(richFixture());
    const result = await client.callTool({
      name: "check_answer",
      arguments: { questionId: 999, optionId: 1 },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("Question 999 not found");
  });

  it.each([0, -1, 1.5, "1", Number.MAX_SAFE_INTEGER + 1])(
    "invalid questionId %s is refused",
    async (value) => {
      const { client } = await withDb(richFixture());
      await h.expectRefused(
        client,
        "check_answer",
        { questionId: value, optionId: 1 },
        "questionId",
      );
    },
  );

  it.each([0, -1, 1.5, "1", Number.MAX_SAFE_INTEGER + 1])(
    "invalid optionId %s is refused",
    async (value) => {
      const { client } = await withDb(richFixture());
      await h.expectRefused(client, "check_answer", { questionId: 1, optionId: value }, "optionId");
    },
  );

  it.each([
    [{}, "questionId"],
    [{ questionId: 1 }, "optionId"],
    [{ optionId: 1 }, "questionId"],
  ])("missing arguments %j are refused", async (args, field) => {
    const { client } = await withDb(richFixture());
    await h.expectRefused(client, "check_answer", args, field);
  });

  it("unexpected service error gives 'Internal error', logged without leaking details", async () => {
    await internalError({ questionId: 1, optionId: 1 });
  });
});
