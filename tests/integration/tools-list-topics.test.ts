import { afterEach, describe, expect, it, vi } from "vitest";
import { createMcpHarness, LEAK, textOf } from "../helpers/mcp.js";
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

describe("tool list_topics", () => {
  const h = createMcpHarness();

  afterEach(async () => {
    await h.dispose();
    loggerError.mockClear();
  });

  const { withDb } = h;

  const internalError = (args: Record<string, unknown>) =>
    h.expectInternalError("list_topics", args, loggerError);

  it("lists topics as exactly {id, name}, mirrored in structuredContent and text", async () => {
    const { client, db } = await withDb(richFixture());
    const result = await client.callTool({ name: "list_topics", arguments: {} });
    expect(result.isError).toBeFalsy();
    const rows = db.prepare("SELECT id, name FROM topics").all() as { id: number; name: string }[];
    const expected = rows.map((r) => ({ id: Number(r.id), name: r.name }));
    const data = result.structuredContent as unknown as { topics: { id: number; name: string }[] };
    expect(Object.keys(data)).toEqual(["topics"]);
    expect([...data.topics].sort((a, b) => a.id - b.id)).toEqual(
      expected.sort((a, b) => a.id - b.id),
    );
    expect(data.topics.map((t) => t.name).sort()).toEqual(["Alpha", "Beta"]);
    for (const t of data.topics) expect(Object.keys(t).sort()).toEqual(["id", "name"]);
    expect(JSON.parse(textOf(result))).toEqual(data);
  });

  it("empty database gives an empty list, not an error", async () => {
    const { client } = await withDb();
    const result = await client.callTool({ name: "list_topics", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ topics: [] });
  });

  it("result has no question, option, note or answer data", async () => {
    const { client } = await withDb(richFixture());
    const result = await client.callTool({ name: "list_topics", arguments: {} });
    const serialized = JSON.stringify({
      content: result.content,
      structuredContent: result.structuredContent,
    });
    expect(serialized).not.toMatch(LEAK);
    expect(serialized).not.toMatch(/MARKER|TEST question|Test note|options|question/i);
  });

  it("unexpected service error gives 'Internal error', logged without leaking details", async () => {
    await internalError({});
  });
});
