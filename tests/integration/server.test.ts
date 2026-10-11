import { DatabaseSync } from "node:sqlite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importSeedData } from "../../src/db/import.js";
import { createRepository } from "../../src/db/repository.js";
import { createServer } from "../../src/server.js";
import { createQuizService } from "../../src/services/quiz.js";
import { richFixture, seedData } from "../helpers/seed-json.js";

// TEST DATA ONLY: synthetic fixtures, not real exam content.

vi.mock("../../src/lib/logger.js", () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

const LEAK = /is_?correct|explanation|correctOptionId/i;

describe("createServer", () => {
  let client: Client;
  let server: McpServer;
  let db: DatabaseSync;

  beforeEach(async () => {
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    importSeedData(db, seedData(richFixture()));
    server = createServer(createQuizService(createRepository(db)));
    client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
    db.close();
  });

  it("connects and identifies itself", () => {
    expect(client.getServerVersion()?.name).toBe("certquiz");
  });

  it("lists exactly the five tools, all read-only", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "check_answer",
      "get_explanation",
      "get_question",
      "get_short_notes",
      "list_topics",
    ]);
    for (const tool of tools) expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
  });

  it("only check_answer declares correctOptionId in its output schema", async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      const schema = JSON.stringify(tool.outputSchema ?? {});
      if (tool.name === "check_answer") {
        expect(Object.keys(tool.outputSchema?.properties ?? {}).sort()).toEqual([
          "correct",
          "correctOptionId",
        ]);
      } else {
        expect(schema, tool.name).not.toMatch(/correctOptionId|is_?correct/i);
      }
    }
  });

  it("invariant: only check_answer reveals the correct option id in call results", async () => {
    const qid = Number(
      (
        db.prepare("SELECT id FROM questions WHERE text = ?").get("TEST question 1?") as {
          id: number;
        }
      ).id,
    );
    const calls = [
      { name: "list_topics", arguments: {} },
      { name: "get_question", arguments: {} },
      { name: "get_question", arguments: { questionId: qid } },
      { name: "get_short_notes", arguments: { questionId: qid } },
    ];
    for (const call of calls) {
      const result = await client.callTool(call);
      expect(result.isError, call.name).toBeFalsy();
      const serialized = JSON.stringify({
        content: result.content,
        structuredContent: result.structuredContent,
      });
      expect(serialized, call.name).not.toMatch(/is_?correct|correctOptionId|"correct"/i);
    }
    const options = db
      .prepare("SELECT id, is_correct FROM options WHERE question_id = ?")
      .all(qid) as { id: number; is_correct: number }[];
    const correct = options.find((o) => Number(o.is_correct) === 1);
    const wrong = options.find((o) => Number(o.is_correct) !== 1);
    if (!correct || !wrong) throw new Error("fixture needs a correct and a wrong option");
    const correctId = Number(correct.id);
    const wrongId = Number(wrong.id);
    for (const [optionId, isCorrect] of [
      [correctId, true],
      [wrongId, false],
    ] as const) {
      const answer = await client.callTool({
        name: "check_answer",
        arguments: { questionId: qid, optionId },
      });
      expect(answer.isError).toBeFalsy();
      expect(answer.structuredContent).toEqual({ correct: isCorrect, correctOptionId: correctId });
    }
  });

  it("has optional questionId and topicId inputs", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "get_question");
    const schema = tool?.inputSchema;
    for (const key of ["questionId", "topicId"]) {
      expect(schema?.properties).toHaveProperty(key);
      expect(schema?.required ?? []).not.toContain(key);
    }
    expect(tool?.description).toMatch(/questionId/);
    expect(tool?.description).toMatch(/random/i);
    const described = schema?.properties?.questionId as { description?: string } | undefined;
    expect(described?.description).toMatch(/optional/i);
    expect(described?.description).toMatch(/random/i);
  });

  it("has an output schema without correctness or explanation fields", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "get_question");
    expect(tool?.outputSchema).toBeDefined();
    expect(JSON.stringify(tool?.outputSchema)).not.toMatch(LEAK);
    expect(Object.keys(tool?.outputSchema?.properties ?? {}).sort()).toEqual([
      "id",
      "options",
      "text",
    ]);
  });

  it("lists the three resource templates", async () => {
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map((t) => t.uriTemplate).sort()).toEqual([
      "quiz://questions/{id}",
      "quiz://questions/{id}/short-notes",
      "quiz://topics/{id}",
    ]);
  });

  it("reads a resource through the created server", async () => {
    const row = db.prepare("SELECT id FROM topics WHERE name = ?").get("Beta") as { id: number };
    const id = Number(row.id);
    const result = await client.readResource({ uri: `quiz://topics/${id}` });
    const first = result.contents[0];
    if (!first || !("text" in first)) throw new Error("no text content");
    expect(JSON.parse(first.text)).toEqual({ id, name: "Beta" });
  });
});
