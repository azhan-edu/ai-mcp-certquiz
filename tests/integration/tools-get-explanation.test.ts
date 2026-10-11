import { afterEach, describe, expect, it, vi } from "vitest";
import { createMcpHarness, questionId, textOf } from "../helpers/mcp.js";
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

describe("tool get_explanation", () => {
  const h = createMcpHarness();

  afterEach(async () => {
    await h.dispose();
    loggerError.mockClear();
  });

  const { withDb } = h;

  const internalError = (args: Record<string, unknown>) =>
    h.expectInternalError("get_explanation", args, loggerError);

  it.each([
    ["TEST question 1?", "Explanation 1."],
    ["TEST question 2?", "Explanation 2."],
  ])("returns the stored explanation of %s", async (text, explanation) => {
    const { client, db } = await withDb(richFixture());
    const id = questionId(db, text);
    const result = await client.callTool({
      name: "get_explanation",
      arguments: { questionId: id },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ questionId: id, explanation });
    expect(JSON.parse(textOf(result))).toEqual(result.structuredContent);
  });

  it("unknown question gives a short isError", async () => {
    const { client } = await withDb(richFixture());
    const result = await client.callTool({
      name: "get_explanation",
      arguments: { questionId: 999 },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("Question 999 not found");
    expect(result.structuredContent).toBeUndefined();
  });

  it.each([0, -1, 1.5, "1", Number.MAX_SAFE_INTEGER + 1])(
    "invalid questionId %s is refused",
    async (value) => {
      const { client } = await withDb(richFixture());
      await h.expectRefused(client, "get_explanation", { questionId: value }, "questionId");
    },
  );

  it("missing questionId is refused", async () => {
    const { client } = await withDb(richFixture());
    await h.expectRefused(client, "get_explanation", {}, "questionId");
  });

  it("unexpected service error gives 'Internal error', logged without leaking details", async () => {
    await internalError({ questionId: 1 });
  });

  it("result has exactly questionId and explanation and no option data", async () => {
    const { client, db } = await withDb(richFixture());
    const result = await client.callTool({
      name: "get_explanation",
      arguments: { questionId: questionId(db, "TEST question 1?") },
    });
    expect(Object.keys(result.structuredContent ?? {}).sort()).toEqual([
      "explanation",
      "questionId",
    ]);
    expect(JSON.stringify(result)).not.toMatch(/is_?correct|correctOptionId|MARKER/i);
  });
});
