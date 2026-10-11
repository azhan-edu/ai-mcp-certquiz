import { afterEach, describe, expect, it, vi } from "vitest";
import { createMcpHarness, LEAK, questionId, textOf } from "../helpers/mcp.js";
import { notesOrderFixture, richFixture } from "../helpers/seed-json.js";

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

describe("tool get_short_notes", () => {
  const h = createMcpHarness();

  afterEach(async () => {
    await h.dispose();
    loggerError.mockClear();
  });

  const { withDb } = h;

  const internalError = (args: Record<string, unknown>) =>
    h.expectInternalError("get_short_notes", args, loggerError);

  interface Notes {
    questionId: number;
    notes: { id: number; title: string; text: string }[];
  }

  it("returns the notes of a question, mirrored in structuredContent and text", async () => {
    const { client, db } = await withDb(richFixture());
    const id = questionId(db, "TEST question 1?");
    const result = await client.callTool({
      name: "get_short_notes",
      arguments: { questionId: id },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      questionId: id,
      notes: [
        { id: 1, title: "Note one", text: "Test note one." },
        { id: 2, title: "Note two", text: "Test note two." },
      ],
    });
    expect(JSON.parse(textOf(result))).toEqual(result.structuredContent);
  });

  it("orders notes by note id, not by title or link order", async () => {
    const { client, db } = await withDb(notesOrderFixture());
    const result = await client.callTool({
      name: "get_short_notes",
      arguments: { questionId: questionId(db, "TEST notes question?") },
    });
    const data = result.structuredContent as unknown as Notes;
    expect(data.notes.map((n) => n.title)).toEqual(["Zulu note", "Alpha note", "Mike note"]);
    const ids = data.notes.map((n) => n.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it("a question without notes gives a short isError", async () => {
    const { client, db } = await withDb(richFixture());
    const id = questionId(db, "TEST question 2?");
    const result = await client.callTool({
      name: "get_short_notes",
      arguments: { questionId: id },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(`Question ${id} has no short notes`);
    expect(result.structuredContent).toBeUndefined();
  });

  it("unknown question gives a short isError", async () => {
    const { client } = await withDb(richFixture());
    const result = await client.callTool({
      name: "get_short_notes",
      arguments: { questionId: 999 },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("Question 999 not found");
  });

  it.each([0, -1, 1.5, "1", Number.MAX_SAFE_INTEGER + 1])(
    "invalid questionId %s is refused",
    async (value) => {
      const { client } = await withDb(richFixture());
      await h.expectRefused(client, "get_short_notes", { questionId: value }, "questionId");
    },
  );

  it("missing questionId is refused", async () => {
    const { client } = await withDb(richFixture());
    await h.expectRefused(client, "get_short_notes", {}, "questionId");
  });

  it("unexpected service error gives 'Internal error', logged without leaking details", async () => {
    await internalError({ questionId: 1 });
  });

  it("invariant: notes never expose the correct option or the explanation", async () => {
    const { client, db } = await withDb(richFixture());
    const result = await client.callTool({
      name: "get_short_notes",
      arguments: { questionId: questionId(db, "TEST question 1?") },
    });
    expect(
      JSON.stringify({ content: result.content, structuredContent: result.structuredContent }),
    ).not.toMatch(LEAK);
    const data = result.structuredContent as unknown as Notes;
    for (const n of data.notes) expect(Object.keys(n).sort()).toEqual(["id", "text", "title"]);
    expect(Object.keys(data).sort()).toEqual(["notes", "questionId"]);
  });
});
