import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMcpHarness } from "../helpers/mcp.js";
import { richFixture } from "../helpers/seed-json.js";

// TEST DATA ONLY: synthetic fixtures, not real exam content.

vi.mock("../../src/lib/logger.js", () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

const PROMPT_LEAK = /is_?correct|correctOptionId/i;
// Content of the richFixture that a data-free prompt must never contain.
const FIXTURE_DATA = /MARKER|TEST question|Explanation \d|Test note|Note (one|two)|Alpha|Beta/;

const NAMES = [
  "check_answer",
  "get_question",
  "get_question_explanation",
  "get_question_notes",
  "list_topics",
];

describe("prompts", () => {
  const h = createMcpHarness();
  afterEach(() => h.dispose());

  async function getText(
    client: Awaited<ReturnType<typeof h.withDb>>["client"],
    name: string,
    args?: Record<string, string>,
  ): Promise<string> {
    const result = await client.getPrompt({ name, arguments: args });
    expect(result.messages).toHaveLength(1);
    const message = result.messages[0];
    expect(message?.role).toBe("user");
    if (message?.content.type !== "text") throw new Error("expected text content");
    return message.content.text;
  }

  async function expectInvalidParams(p: Promise<unknown>): Promise<void> {
    const error = await p.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(McpError);
    expect((error as McpError).code).toBe(ErrorCode.InvalidParams);
  }

  it("lists exactly the five prompts, each with a description", async () => {
    const { client } = await h.withDb(richFixture());
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual(NAMES);
    for (const p of prompts) expect(p.description, p.name).toMatch(/\S/);
  });

  it("declares arguments: only topicId is optional, list_topics has none", async () => {
    const { client } = await h.withDb(richFixture());
    const { prompts } = await client.listPrompts();
    const args = (n: string) => prompts.find((p) => p.name === n)?.arguments ?? [];
    expect(args("get_question").map((a) => [a.name, a.required ?? false])).toEqual([
      ["topicId", false],
    ]);
    expect(args("check_answer").map((a) => [a.name, a.required])).toEqual([
      ["questionId", true],
      ["optionId", true],
    ]);
    expect(args("get_question_explanation").map((a) => a.name)).toEqual(["questionId"]);
    expect(args("get_question_notes").map((a) => a.name)).toEqual(["questionId"]);
    expect(args("list_topics")).toEqual([]);
  });

  describe("getPrompt", () => {
    it("get_question without arguments, with empty topicId: no topic in the instruction", async () => {
      const { client } = await h.withDb(richFixture());
      const variants: (Record<string, string> | undefined)[] = [undefined, {}, { topicId: "" }];
      for (const args of variants) {
        const text = await getText(client, "get_question", args);
        expect(text).toContain("get_question");
        expect(text).not.toMatch(/topicId \d/);
      }
    });

    it("get_question with topicId substitutes it", async () => {
      const { client } = await h.withDb(richFixture());
      const text = await getText(client, "get_question", { topicId: "42" });
      expect(text).toContain("get_question");
      expect(text).toContain("topicId 42");
    });

    it("check_answer substitutes both ids", async () => {
      const { client } = await h.withDb(richFixture());
      const text = await getText(client, "check_answer", { questionId: "7", optionId: "19" });
      expect(text).toContain("check_answer");
      expect(text).toContain("questionId 7");
      expect(text).toContain("optionId 19");
    });

    it("get_question_explanation points to get_explanation", async () => {
      const { client } = await h.withDb(richFixture());
      const text = await getText(client, "get_question_explanation", { questionId: "5" });
      expect(text).toContain("get_explanation");
      expect(text).toContain("questionId 5");
    });

    it("get_question_notes points to get_short_notes", async () => {
      const { client } = await h.withDb(richFixture());
      const text = await getText(client, "get_question_notes", { questionId: "6" });
      expect(text).toContain("get_short_notes");
      expect(text).toContain("questionId 6");
    });

    it("list_topics points to the list_topics tool", async () => {
      const { client } = await h.withDb(richFixture());
      expect(await getText(client, "list_topics")).toContain("list_topics");
    });

    it("does not read the DB: works on an empty schema and for ids that do not exist", async () => {
      const { client } = await h.withDb();
      expect(await getText(client, "get_question_notes", { questionId: "999" })).toContain(
        "questionId 999",
      );
      expect(await getText(client, "get_question")).toContain("get_question");
    });
  });

  describe("invalid arguments", () => {
    const BAD = ["0", "-1", "abc", "1.5", "99999999999999999999", "", " 1", "1e3", "01"];

    it.each(BAD)("rejects questionId %j with InvalidParams", async (value) => {
      const { client } = await h.withDb(richFixture());
      for (const name of ["get_question_explanation", "get_question_notes"]) {
        await expectInvalidParams(client.getPrompt({ name, arguments: { questionId: value } }));
      }
      await expectInvalidParams(
        client.getPrompt({
          name: "check_answer",
          arguments: { questionId: value, optionId: "1" },
        }),
      );
      await expectInvalidParams(
        client.getPrompt({
          name: "check_answer",
          arguments: { questionId: "1", optionId: value },
        }),
      );
    });

    it.each(BAD.filter((v) => v !== ""))("rejects topicId %j with InvalidParams", async (value) => {
      const { client } = await h.withDb(richFixture());
      await expectInvalidParams(
        client.getPrompt({ name: "get_question", arguments: { topicId: value } }),
      );
    });

    it("rejects missing required arguments", async () => {
      const { client } = await h.withDb(richFixture());
      await expectInvalidParams(client.getPrompt({ name: "get_question_explanation" }));
      await expectInvalidParams(client.getPrompt({ name: "get_question_notes", arguments: {} }));
      await expectInvalidParams(client.getPrompt({ name: "check_answer" }));
      await expectInvalidParams(
        client.getPrompt({ name: "check_answer", arguments: { questionId: "1" } }),
      );
      await expectInvalidParams(
        client.getPrompt({ name: "check_answer", arguments: { optionId: "1" } }),
      );
    });

    it("rejects an unknown prompt", async () => {
      const { client } = await h.withDb(richFixture());
      await expect(client.getPrompt({ name: "nope" })).rejects.toBeInstanceOf(McpError);
    });
  });

  describe("invariant", () => {
    it("listPrompts and every getPrompt result carry no answer key and no fixture data", async () => {
      const { client } = await h.withDb(richFixture());
      const serialized: Record<string, string> = {
        list: JSON.stringify(await client.listPrompts()),
      };
      const calls: [string, Record<string, string> | undefined][] = [
        ["get_question", undefined],
        ["get_question", { topicId: "1" }],
        ["check_answer", { questionId: "1", optionId: "3" }],
        ["check_answer", { questionId: "1", optionId: "1" }],
        ["get_question_explanation", { questionId: "1" }],
        ["get_question_notes", { questionId: "1" }],
        ["list_topics", undefined],
      ];
      for (const [name, args] of calls) {
        serialized[`${name} ${JSON.stringify(args)}`] = JSON.stringify(
          await client.getPrompt({ name, arguments: args }),
        );
      }
      for (const [label, text] of Object.entries(serialized)) {
        expect(text, label).not.toMatch(PROMPT_LEAK);
        expect(text, label).not.toMatch(FIXTURE_DATA);
      }
    });

    it("check_answer prompt output is identical for a correct and a wrong option", async () => {
      const { client } = await h.withDb(richFixture());
      const strip = (t: string) => t.replace(/optionId \d+/, "optionId N");
      const right = await getText(client, "check_answer", { questionId: "1", optionId: "3" });
      const wrong = await getText(client, "check_answer", { questionId: "1", optionId: "1" });
      expect(strip(right)).toBe(strip(wrong));
    });
  });
});
