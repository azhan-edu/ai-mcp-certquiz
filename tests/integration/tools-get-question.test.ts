import { afterEach, describe, expect, it, vi } from "vitest";
import { createMcpHarness, LEAK, questionId, textOf, topicId } from "../helpers/mcp.js";
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

interface Question {
  id: number;
  text: string;
  options: { id: number; label: string }[];
}

describe("tool get_question", () => {
  const h = createMcpHarness();

  afterEach(async () => {
    await h.dispose();
    loggerError.mockClear();
  });

  const { withDb } = h;

  it("returns a question without arguments, mirrored in structuredContent and text", async () => {
    const { client } = await withDb(richFixture());
    const result = await client.callTool({ name: "get_question", arguments: {} });
    expect(result.isError).toBeFalsy();
    const q = result.structuredContent as unknown as Question;
    expect(q).toEqual({
      id: expect.any(Number),
      text: expect.stringMatching(/^TEST question [12]\?$/),
      options: expect.any(Array),
    });
    for (const o of q.options)
      expect(o).toEqual({ id: expect.any(Number), label: expect.any(String) });
    expect(JSON.parse(textOf(result))).toEqual(q);
  });

  it("returns a question of the requested topic", async () => {
    const { client, db } = await withDb(richFixture());
    // fixture: question 1 is in Beta, question 2 is in Alpha
    for (const [name, text] of [
      ["Alpha", "TEST question 2?"],
      ["Beta", "TEST question 1?"],
    ] as const) {
      for (let i = 0; i < 5; i++) {
        const result = await client.callTool({
          name: "get_question",
          arguments: { topicId: topicId(db, name) },
        });
        expect((result.structuredContent as unknown as Question).text).toBe(text);
      }
    }
  });

  it.each([
    ["TEST question 1?", "MARKER-1"],
    ["TEST question 2?", "MARKER-2"],
  ])("questionId returns exactly that question (%s)", async (text, marker) => {
    const { client, db } = await withDb(richFixture());
    const id = questionId(db, text);
    for (let i = 0; i < 5; i++) {
      const result = await client.callTool({ name: "get_question", arguments: { questionId: id } });
      expect(result.isError).toBeFalsy();
      const q = result.structuredContent as unknown as Question;
      expect(q.id).toBe(id);
      expect(q.text).toBe(text);
      expect(q.options.length).toBeGreaterThan(0);
      for (const o of q.options) expect(o.label.startsWith(marker)).toBe(true);
      expect(JSON.parse(textOf(result))).toEqual(q);
    }
  });

  it("unknown questionId gives a short isError", async () => {
    const { client } = await withDb(richFixture());
    const result = await client.callTool({ name: "get_question", arguments: { questionId: 999 } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("Question 999 not found");
  });

  it("questionId together with topicId gives a short isError", async () => {
    const { client, db } = await withDb(richFixture());
    const result = await client.callTool({
      name: "get_question",
      arguments: { questionId: questionId(db, "TEST question 1?"), topicId: topicId(db, "Beta") },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("Specify either questionId or topicId, not both");
  });

  it.each([0, -1, 1.5, "1", Number.MAX_SAFE_INTEGER + 1])(
    "invalid questionId %s is refused",
    async (value) => {
      const { client } = await withDb(richFixture());
      await h.expectRefused(client, "get_question", { questionId: value }, "questionId");
    },
  );

  it("without questionId the result is a valid question", async () => {
    const { client } = await withDb(richFixture());
    for (let i = 0; i < 5; i++) {
      const result = await client.callTool({ name: "get_question", arguments: {} });
      expect(result.isError).toBeFalsy();
      const q = result.structuredContent as unknown as Question;
      expect(q.text).toMatch(/^TEST question [12]\?$/);
      expect(q.options.length).toBeGreaterThan(0);
    }
  });

  it("unknown topic gives a short isError", async () => {
    const { client } = await withDb(richFixture());
    const result = await client.callTool({
      name: "get_question",
      arguments: { topicId: 999 },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("Topic 999 not found");
  });

  it("empty topic gives a short isError", async () => {
    const { client, db } = await withDb(richFixture());
    db.prepare("INSERT INTO topics (name) VALUES (?)").run("TEST empty topic");
    const id = topicId(db, "TEST empty topic");
    const result = await client.callTool({
      name: "get_question",
      arguments: { topicId: id },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(`Topic ${id} has no questions`);
  });

  it("empty database gives a short isError", async () => {
    const { client } = await withDb();
    const result = await client.callTool({ name: "get_question", arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("No questions available");
  });

  it.each([0, -1, 1.5, "1", Number.MAX_SAFE_INTEGER + 1])(
    "invalid topicId %s is refused",
    async (value) => {
      const { client } = await withDb(richFixture());
      await h.expectRefused(client, "get_question", { topicId: value }, "topicId");
    },
  );

  it("unexpected service error gives 'Internal error', logged without leaking details", async () => {
    await h.expectInternalError("get_question", {}, loggerError);
  });

  describe("invariant: no answer leak", () => {
    it("results never match LEAK and options have exactly id and label", async () => {
      const { client, db } = await withDb(richFixture());
      const seen = new Set<string>();
      for (let i = 0; i < 40; i++) {
        const args = [
          {},
          { topicId: topicId(db, "Alpha") },
          { topicId: topicId(db, "Beta") },
          { questionId: questionId(db, "TEST question 1?") },
          { questionId: questionId(db, "TEST question 2?") },
        ][i % 5];
        const result = await client.callTool({ name: "get_question", arguments: args });
        expect(result.isError).toBeFalsy();
        expect(
          JSON.stringify({ content: result.content, structuredContent: result.structuredContent }),
        ).not.toMatch(LEAK);
        const q = result.structuredContent as unknown as Question;
        expect(Object.keys(q).sort()).toEqual(["id", "options", "text"]);
        expect(q.options.length).toBeGreaterThan(0);
        for (const o of q.options) expect(Object.keys(o).sort()).toEqual(["id", "label"]);
        seen.add(q.text);
      }
      // Both fixture questions were served, so the invariant held for each of them.
      expect(seen.size).toBe(2);
    });

    it("calls with questionId never leak and return exact key sets", async () => {
      const { client, db } = await withDb(richFixture());
      for (const text of ["TEST question 1?", "TEST question 2?"]) {
        const result = await client.callTool({
          name: "get_question",
          arguments: { questionId: questionId(db, text) },
        });
        expect(result.isError).toBeFalsy();
        expect(
          JSON.stringify({ content: result.content, structuredContent: result.structuredContent }),
        ).not.toMatch(LEAK);
        const q = result.structuredContent as unknown as Question;
        expect(Object.keys(q).sort()).toEqual(["id", "options", "text"]);
        for (const o of q.options) expect(Object.keys(o).sort()).toEqual(["id", "label"]);
      }
    });
  });
});
