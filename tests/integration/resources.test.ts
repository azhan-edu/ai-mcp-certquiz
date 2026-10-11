import { DatabaseSync } from "node:sqlite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importSeedData } from "../../src/db/import.js";
import { createRepository } from "../../src/db/repository.js";
import { registerResources } from "../../src/resources/index.js";
import { createQuizService, type QuizService } from "../../src/services/quiz.js";
import { notesOrderFixture, richFixture, seedData } from "../helpers/seed-json.js";

// TEST DATA ONLY: synthetic fixtures, not real exam content.

// Silence and observe the module-level logger used by readJson.
const loggerError = vi.hoisted(() => vi.fn());
vi.mock("../../src/lib/logger.js", () => ({
  createLogger: () => ({
    error: loggerError,
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

const LEAK = /is_?correct|explanation|correctOptionId/i;

describe("quiz resources", () => {
  let client: Client;
  let server: McpServer;
  let db: DatabaseSync;

  // DB ids are assigned by the import (not the fixture ids), so look them up by content.
  const idOf = (sql: string, value: string): number =>
    Number((db.prepare(sql).get(value) as { id: number }).id);
  const q1 = () => idOf("SELECT id FROM questions WHERE text = ?", "TEST question 1?");
  const q2 = () => idOf("SELECT id FROM questions WHERE text = ?", "TEST question 2?");

  beforeEach(async () => {
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    importSeedData(db, seedData(richFixture()));
    server = new McpServer({ name: "test", version: "0.0.0" });
    registerResources(server, createQuizService(createRepository(db)));
    client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
    db.close();
    loggerError.mockClear();
  });

  async function read(uri: string): Promise<{ text: string; parsed: unknown }> {
    const result = await client.readResource({ uri });
    const first = result.contents[0];
    if (!first || !("text" in first)) throw new Error("no text content");
    return { text: first.text, parsed: JSON.parse(first.text) };
  }

  it("lists the three resource templates", async () => {
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map((t) => t.uriTemplate).sort()).toEqual([
      "quiz://questions/{id}",
      "quiz://questions/{id}/short-notes",
      "quiz://topics/{id}",
    ]);
  });

  it("lists concrete resources so clients can autocomplete them", async () => {
    const { resources } = await client.listResources();
    const alpha = idOf("SELECT id FROM topics WHERE name = ?", "Alpha");
    const uris = resources.map((r) => r.uri);
    expect(uris).toContain(`quiz://topics/${alpha}`);
    expect(uris).toContain(`quiz://questions/${q1()}`);
    expect(uris).toContain(`quiz://questions/${q2()}`);
    expect(uris).toContain(`quiz://questions/${q1()}/short-notes`);
    expect(resources.find((r) => r.uri === `quiz://topics/${alpha}`)?.name).toBe("Alpha");
    for (const resource of resources) {
      expect((await read(resource.uri)).parsed).toBeDefined();
    }
  });

  it("reads a topic", async () => {
    const id = idOf("SELECT id FROM topics WHERE name = ?", "Beta");
    expect((await read(`quiz://topics/${id}`)).parsed).toEqual({ id, name: "Beta" });
  });

  it("reads a question with options in position order", async () => {
    const { parsed } = await read(`quiz://questions/${q1()}`);
    expect(parsed).toEqual({
      id: q1(),
      text: "TEST question 1?",
      options: [
        { id: expect.any(Number), label: "MARKER-1A" },
        { id: expect.any(Number), label: "MARKER-1B" },
        { id: expect.any(Number), label: "MARKER-1C" },
      ],
    });
  });

  it("reads short notes ordered by id", async () => {
    const notes = (await read(`quiz://questions/${q1()}/short-notes`)).parsed as {
      id: number;
      title: string;
      text: string;
    }[];
    expect(notes.map((n) => n.title).sort()).toEqual(["Note one", "Note two"]);
    expect(notes.map((n) => n.id)).toEqual(notes.map((n) => n.id).sort((a, b) => a - b));
    for (const n of notes) {
      expect(n.text).toBe(`Test note ${n.title === "Note one" ? "one" : "two"}.`);
    }
  });

  it("returns [] for a question without notes", async () => {
    expect((await read(`quiz://questions/${q2()}/short-notes`)).parsed).toEqual([]);
  });

  it.each(["quiz://topics/999", "quiz://questions/999", "quiz://questions/999/short-notes"])(
    "unknown id %s -> -32002",
    async (uri) => {
      await expect(client.readResource({ uri })).rejects.toMatchObject({ code: -32002 });
    },
  );

  it.each([
    "quiz://topics/abc",
    "quiz://topics/0",
    "quiz://topics/-1",
    "quiz://questions/abc",
    "quiz://questions/0",
    "quiz://questions/-3",
    "quiz://questions/1.5",
    "quiz://questions/abc/short-notes",
    "quiz://questions/0/short-notes",
    "quiz://questions/-1/short-notes",
    ...["0x10", "1e1", "1.0", "01", "9007199254740992", "99999999999999999999"].flatMap((v) => [
      `quiz://topics/${v}`,
      `quiz://questions/${v}`,
      `quiz://questions/${v}/short-notes`,
    ]),
  ])("invalid id %s -> -32602", async (uri) => {
    await expect(client.readResource({ uri })).rejects.toMatchObject({ code: -32602 });
  });

  it("reads short notes in note id order, not title or link order", async () => {
    const fresh = new DatabaseSync(":memory:");
    const freshServer = new McpServer({ name: "test", version: "0.0.0" });
    const freshClient = new Client({ name: "test-client", version: "0.0.0" });
    try {
      fresh.exec("PRAGMA foreign_keys = ON");
      importSeedData(fresh, seedData(notesOrderFixture()));
      registerResources(freshServer, createQuizService(createRepository(fresh)));
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await Promise.all([freshServer.connect(st), freshClient.connect(ct)]);
      const noteId = (title: string): number =>
        Number(
          (fresh.prepare("SELECT id FROM short_notes WHERE title = ?").get(title) as { id: number })
            .id,
        );
      const qid = Number((fresh.prepare("SELECT id FROM questions").get() as { id: number }).id);
      const result = await freshClient.readResource({ uri: `quiz://questions/${qid}/short-notes` });
      const first = result.contents[0];
      if (!first || !("text" in first)) throw new Error("no text content");
      expect(JSON.parse(first.text)).toEqual([
        { id: noteId("Zulu note"), title: "Zulu note", text: "Test body of Zulu note." },
        { id: noteId("Alpha note"), title: "Alpha note", text: "Test body of Alpha note." },
        { id: noteId("Mike note"), title: "Mike note", text: "Test body of Mike note." },
      ]);
    } finally {
      await freshClient.close();
      await freshServer.close();
      fresh.close();
    }
  });

  describe("internal errors", () => {
    const boom = (): never => {
      throw new Error("secret detail");
    };
    const failing: QuizService = {
      getTopic: boom,
      listTopics: boom,
      listQuestionIds: boom,
      getQuestion: boom,
      getRandomQuestion: boom,
      checkAnswer: boom,
      getExplanation: boom,
      listShortNotes: boom,
      getShortNotes: boom,
    };

    it.each(["quiz://topics/1", "quiz://questions/1", "quiz://questions/1/short-notes"])(
      "unexpected error on %s -> -32603 without internals",
      async (uri) => {
        const s = new McpServer({ name: "test", version: "0.0.0" });
        const c = new Client({ name: "test-client", version: "0.0.0" });
        registerResources(s, failing);
        const [ct, st] = InMemoryTransport.createLinkedPair();
        await Promise.all([s.connect(st), c.connect(ct)]);
        try {
          const error = await c.readResource({ uri }).then(
            () => undefined,
            (e: unknown) => e,
          );
          expect(error).toMatchObject({ code: -32603 });
          expect((error as Error).message).not.toContain("secret detail");
          expect(loggerError).toHaveBeenCalledTimes(1);
        } finally {
          await c.close();
          await s.close();
        }
      },
    );
  });

  describe("invariant: no answer leak", () => {
    it("topic and question resources contain no correctness data", async () => {
      const ids = [
        `quiz://topics/${idOf("SELECT id FROM topics WHERE name = ?", "Alpha")}`,
        `quiz://topics/${idOf("SELECT id FROM topics WHERE name = ?", "Beta")}`,
        `quiz://questions/${q1()}`,
        `quiz://questions/${q2()}`,
      ];
      for (const uri of ids) {
        const { text } = await read(uri);
        expect(text).not.toMatch(LEAK);
      }
    });

    it("listed resources (uri, name, description) contain no correctness data", async () => {
      const { resources } = await client.listResources();
      expect(resources.length).toBeGreaterThan(0);
      expect(JSON.stringify(resources)).not.toMatch(LEAK);
    });

    it("question option keys are exactly id and label, question keys id, text, options", async () => {
      for (const id of [q1(), q2()]) {
        const { parsed } = await read(`quiz://questions/${id}`);
        const q = parsed as { options: object[] };
        expect(Object.keys(q).sort()).toEqual(["id", "options", "text"]);
        for (const option of q.options) {
          expect(Object.keys(option).sort()).toEqual(["id", "label"]);
        }
      }
    });

    it("option order follows position, not correctness", async () => {
      // question 1: the correct option sits at position 2 (middle); question 2 at position 1
      const first = (await read(`quiz://questions/${q1()}`)).parsed as {
        options: { label: string }[];
      };
      expect(first.options.map((o) => o.label)).toEqual(["MARKER-1A", "MARKER-1B", "MARKER-1C"]);
      const second = (await read(`quiz://questions/${q2()}`)).parsed as {
        options: { label: string }[];
      };
      expect(second.options.map((o) => o.label)).toEqual(["MARKER-2A", "MARKER-2B"]);
    });

    it("option ids increase with position even though the correct option is in the middle", async () => {
      const { options } = (await read(`quiz://questions/${q1()}`)).parsed as {
        options: { id: number; label: string }[];
      };
      expect(options.map((o) => o.label)).toEqual(["MARKER-1A", "MARKER-1B", "MARKER-1C"]);
      const ids = options.map((o) => o.id);
      expect(ids).toEqual([...ids].sort((a, b) => a - b));
    });

    it("short notes have only id, title, text keys (no is_correct/explanation/correctOptionId)", async () => {
      const { parsed } = await read(`quiz://questions/${q1()}/short-notes`);
      for (const note of parsed as object[]) {
        expect(Object.keys(note).sort()).toEqual(["id", "text", "title"]);
      }
    });
  });
});
