import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { expect } from "vitest";
import { importSeedData } from "../../src/db/import.js";
import { createRepository } from "../../src/db/repository.js";
import { createServer } from "../../src/server.js";
import { createQuizService, type QuizService } from "../../src/services/quiz.js";
import { type Fixture, seedData } from "./seed-json.js";

// TEST DATA ONLY: shared setup for MCP tool integration tests.
// The vi.mock of the logger must stay in each test file (hoisting).

export const LEAK = /is_?correct|explanation|correctOptionId/i;

/** Messages produced by the service layer or the error wrapper, never by input validation. */
export const SERVICE_MESSAGE = /not found|no short notes|no questions|not both|internal error/i;

export type ToolResult = Awaited<ReturnType<Client["callTool"]>>;

export const questionId = (db: DatabaseSync, text: string): number =>
  Number((db.prepare("SELECT id FROM questions WHERE text = ?").get(text) as { id: number }).id);

export const topicId = (db: DatabaseSync, name: string): number =>
  Number((db.prepare("SELECT id FROM topics WHERE name = ?").get(name) as { id: number }).id);

export function textOf(result: ToolResult): string {
  const content = result.content as { type: string; text?: string }[];
  const first = content[0];
  if (first?.type !== "text" || first.text === undefined) throw new Error("no text");
  return first.text;
}

export interface McpHarness {
  connect(service: QuizService): Promise<Client>;
  withDb(fx?: Fixture): Promise<{ client: Client; db: DatabaseSync }>;
  /** Call from afterEach. */
  dispose(): Promise<void>;
  /**
   * Assert that the call is refused by input validation (not by the service).
   * The SDK error format depends on its version (W5), so the exact text is not pinned: the
   * call may reject or resolve with isError, but must never carry a service message, and
   * must name the offending field.
   */
  expectRefused(
    client: Client,
    name: string,
    args: Record<string, unknown>,
    field: string,
  ): Promise<void>;
  /** A service that throws on every call must surface as a generic "Internal error". */
  expectInternalError(
    name: string,
    args: Record<string, unknown>,
    loggerError: { mock: { calls: unknown[] } },
  ): Promise<void>;
}

export function createMcpHarness(): McpHarness {
  const cleanup: (() => Promise<void> | void)[] = [];

  async function connect(service: QuizService): Promise<Client> {
    const server: McpServer = createServer(service);
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);
    cleanup.push(async () => {
      await client.close();
      await server.close();
    });
    return client;
  }

  return {
    connect,
    async withDb(fx) {
      const db = new DatabaseSync(":memory:");
      db.exec("PRAGMA foreign_keys = ON");
      if (fx) importSeedData(db, seedData(fx));
      else db.exec(readFileSync(new URL("../../src/db/schema.sql", import.meta.url), "utf8"));
      cleanup.push(() => db.close());
      return { client: await connect(createQuizService(createRepository(db))), db };
    },
    async dispose() {
      for (const fn of cleanup.splice(0).reverse()) await fn();
    },
    async expectRefused(client, name, args, field) {
      let message: string;
      try {
        const result = await client.callTool({ name, arguments: args });
        expect(result.isError, "call must fail").toBe(true);
        expect(result.structuredContent).toBeUndefined();
        message = textOf(result);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).not.toMatch(SERVICE_MESSAGE);
      expect(message).toContain(field);
    },
    async expectInternalError(name, args, loggerError) {
      const boom = (): never => {
        throw new Error("secret detail at /var/db.sqlite");
      };
      const failing: QuizService = {
        getTopic: boom,
        listTopics: boom,
        getQuestion: boom,
        getRandomQuestion: boom,
        checkAnswer: boom,
        getExplanation: boom,
        listShortNotes: boom,
        getShortNotes: boom,
      };
      const client = await connect(failing);
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe("Internal error");
      expect(JSON.stringify(result)).not.toContain("secret detail");
      expect(loggerError.mock.calls).toHaveLength(1);
    },
  };
}
