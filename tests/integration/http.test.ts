import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { Writable } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importSeedData } from "../../src/db/import.js";
import { createRepository } from "../../src/db/repository.js";
import { createApp } from "../../src/http.js";
import { createLogger } from "../../src/lib/logger.js";
import { createQuizService, type QuizService } from "../../src/services/quiz.js";
import { questionId } from "../helpers/mcp.js";
import { richFixture, seedData } from "../helpers/seed-json.js";

// TEST DATA ONLY: synthetic fixtures, not real exam content.

// Silence the module-level loggers used by tools/resources (they write to stderr).
vi.mock("../../src/lib/logger.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/lib/logger.js")>();
  return {
    ...original,
    createLogger: (level?: string, destination?: Parameters<typeof original.createLogger>[1]) =>
      destination ? original.createLogger(level, destination) : original.createLogger("silent"),
  };
});

const faults = vi.hoisted(() => ({ createServerError: undefined as Error | undefined }));

// Seam for the generic 500 branch: createServer throws only when a test arms it.
vi.mock("../../src/server.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/server.js")>();
  return {
    ...original,
    createServer: (...args: Parameters<typeof original.createServer>) => {
      if (faults.createServerError) throw faults.createServerError;
      return original.createServer(...args);
    },
  };
});

const LEAK = /is_?correct|correctOptionId/i;
const INTERNALS =
  /secret detail|\/var\/|\.sqlite|\bSELECT\b|\bat .*\(.*:\d+:\d+\)|node_modules|stack/i;

const TEST_TOKEN = "test-token-not-a-secret";
const AUTH = { authorization: `Bearer ${TEST_TOKEN}` };
const ACCEPT = "application/json, text/event-stream";
const INIT = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "raw", version: "0.0.0" },
  },
};

describe("HTTP layer", () => {
  let db: DatabaseSync;
  let server: Server;
  let base: string;
  let logLines: string[];
  const clients: Client[] = [];

  function startApp(service: QuizService): Promise<void> {
    logLines = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        logLines.push(...String(chunk).split("\n").filter(Boolean));
        cb();
      },
    });
    const app = createApp({ service, logger: createLogger("info", sink), authToken: TEST_TOKEN });
    return new Promise((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        resolve();
      });
    });
  }

  beforeEach(async () => {
    faults.createServerError = undefined;
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    importSeedData(db, seedData(richFixture()));
    await startApp(createQuizService(createRepository(db)));
  });

  afterEach(async () => {
    for (const c of clients.splice(0)) await c.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  });

  async function connectClient(): Promise<Client> {
    const client = new Client({ name: "http-test", version: "0.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: AUTH } }),
    );
    clients.push(client);
    return client;
  }

  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: ACCEPT, ...AUTH, ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  /** Raw request so that a GET/DELETE can carry a (malformed) JSON body. */
  const rawRequest = (method: string, path: string, body: string) =>
    new Promise<{ status: number; text: string }>((resolve, reject) => {
      const req = request(
        `${base}${path}`,
        { method, headers: { "content-type": "application/json", accept: ACCEPT, ...AUTH } },
        (res) => {
          let text = "";
          res.setEncoding("utf8");
          res.on("data", (c: string) => {
            text += c;
          });
          res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
        },
      );
      req.on("error", reject);
      req.end(body);
    });

  const rpc = (id: number, method: string, params: unknown) => ({
    jsonrpc: "2.0",
    id,
    method,
    params,
  });

  const callTool = (name: string, args: Record<string, unknown>) =>
    post(rpc(2, "tools/call", { name, arguments: args }));

  describe("health and routing", () => {
    it("GET /health returns exactly {status:'ok'}", async () => {
      const res = await fetch(`${base}/health`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "ok" });
    });

    it("unknown route returns 404", async () => {
      const res = await fetch(`${base}/nope`);
      expect(res.status).toBe(404);
      expect(await res.text()).not.toMatch(INTERNALS);
    });

    it.each(["GET", "DELETE"])("%s /mcp returns 405 with Allow: POST", async (method) => {
      const res = await fetch(`${base}/mcp`, { method, headers: { accept: ACCEPT, ...AUTH } });
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
      const body = (await res.json()) as { jsonrpc: string; error: { code: number } };
      expect(body.jsonrpc).toBe("2.0");
      expect(typeof body.error.code).toBe("number");
    });
  });

  describe("MCP over HTTP", () => {
    it("real client initializes, lists tools and gets a question", async () => {
      const client = await connectClient();
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toContain("get_question");

      const result = await client.callTool({
        name: "get_question",
        arguments: { questionId: questionId(db, "TEST question 1?") },
      });
      expect(result.isError).toBeFalsy();
      const q = result.structuredContent as { text: string; options: { label: string }[] };
      expect(q.text).toBe("TEST question 1?");
      expect(q.options).toHaveLength(3);
    });

    it("is stateless: no session header, independent consecutive requests", async () => {
      const first = await post(INIT);
      expect(first.status).toBe(200);
      expect(first.headers.get("mcp-session-id")).toBeNull();
      await first.text();

      // No initialize or session needed for the next, independent request.
      const second = await post(rpc(2, "tools/list", {}));
      expect(second.status).toBe(200);
      expect(second.headers.get("mcp-session-id")).toBeNull();
      expect(await second.text()).toContain("get_question");

      const third = await post(rpc(3, "tools/list", {}));
      expect(third.status).toBe(200);
      expect(await third.text()).toContain("list_topics");
    });
  });

  describe("bad input", () => {
    it("malformed JSON returns 400 with -32700 and no details", async () => {
      const res = await post('{"jsonrpc": "2.0", broken');
      expect(res.status).toBe(400);
      const text = await res.text();
      const body = JSON.parse(text) as { error: { code: number } };
      expect(body.error.code).toBe(-32700);
      expect(text).not.toMatch(INTERNALS);
      expect(text).not.toContain("broken");
    });

    it("body over 100kb returns 413", async () => {
      const res = await post({
        jsonrpc: "2.0",
        id: 1,
        method: "x",
        params: { pad: "a".repeat(150_000) },
      });
      expect(res.status).toBe(413);
      const body = (await res.json()) as { error: { code: number } };
      expect(body.error.code).toBe(-32600);
    });

    it("malformed JSON body is ignored on GET /health (parser only on POST /mcp)", async () => {
      const res = await rawRequest("GET", "/health", "{broken");
      expect(res.status).toBe(200);
      expect(JSON.parse(res.text)).toEqual({ status: "ok" });
    });

    it("malformed JSON body on DELETE /mcp stays 405", async () => {
      const res = await rawRequest("DELETE", "/mcp", "{broken");
      expect(res.status).toBe(405);
    });
  });

  describe("error hygiene", () => {
    it("a throwing service surfaces as a generic error without internals", async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      const boom = (): never => {
        throw new Error("secret detail at /var/db.sqlite: SELECT * FROM questions");
      };
      await startApp({
        getTopic: boom,
        listTopics: boom,
        getQuestion: boom,
        getRandomQuestion: boom,
        checkAnswer: boom,
        getExplanation: boom,
        listShortNotes: boom,
        getShortNotes: boom,
      });
      const res = await callTool("get_question", {});
      const text = await res.text();
      expect(text).toContain("Internal error");
      expect(text).not.toMatch(INTERNALS);
      expect(logLines.join("\n")).not.toMatch(/secret detail/);
    });
  });

  describe("unhandled errors", () => {
    it("returns a generic 500 / -32603 and logs only the error name", async () => {
      faults.createServerError = new Error(
        "secret detail at /var/db.sqlite: SELECT * FROM questions",
      );
      const res = await post(rpc(2, "tools/list", {}));
      expect(res.status).toBe(500);
      const text = await res.text();
      const body = JSON.parse(text) as { error: { code: number } };
      expect(body.error.code).toBe(-32603);
      expect(text).not.toMatch(INTERNALS);
      expect(text).not.toContain("/var/");

      await vi.waitFor(() =>
        expect(logLines.some((l) => l.includes("unhandled error"))).toBe(true),
      );
      const entry = logLines
        .map((l) => JSON.parse(l) as Record<string, unknown>)
        .find((e) => e.msg === "unhandled error");
      expect(entry?.errName).toBe("Error");
      const all = logLines.join("\n");
      expect(all).not.toContain("secret detail");
      expect(all).not.toContain("/var/db.sqlite");
      expect(all).not.toMatch(/SELECT/);
    });
  });

  describe("logging", () => {
    it("request log has aborted=false for a normal request", async () => {
      await (await fetch(`${base}/health`)).text();
      await vi.waitFor(() => expect(logLines.length).toBeGreaterThanOrEqual(1));
      const entry = logLines
        .map((l) => JSON.parse(l) as Record<string, unknown>)
        .find((e) => e.path === "/health");
      expect(entry?.aborted).toBe(false);
      expect(typeof entry?.aborted).toBe("boolean");
    });

    it("logs method, path, status and durationMs but never body or authorization", async () => {
      const secretBody = "BODY-SECRET-MARKER";
      const res = await post(rpc(5, "tools/list", { note: secretBody }), {
        authorization: `Bearer ${TEST_TOKEN}`,
      });
      await res.text();
      await fetch(`${base}/health?token=QUERY-SECRET-MARKER`);

      await vi.waitFor(() => expect(logLines.length).toBeGreaterThanOrEqual(2));
      const entries = logLines.map((l) => JSON.parse(l) as Record<string, unknown>);
      const mcp = entries.find((e) => e.path === "/mcp");
      expect(mcp).toMatchObject({ method: "POST", path: "/mcp", status: 200 });
      expect(typeof mcp?.durationMs).toBe("number");
      const health = entries.find((e) => e.path === "/health");
      expect(health).toMatchObject({ method: "GET", status: 200 });

      const all = logLines.join("\n");
      expect(all).not.toContain(secretBody);
      expect(all).not.toContain(TEST_TOKEN);
      expect(all).not.toContain("QUERY-SECRET-MARKER");
      expect(all.toLowerCase()).not.toContain("authorization");
    });
  });

  describe("invariant over raw HTTP", () => {
    it("get_question, list_topics and resources never expose is_correct", async () => {
      const id = questionId(db, "TEST question 1?");
      const responses = [
        await callTool("get_question", { questionId: id }),
        await callTool("get_question", {}),
        await callTool("list_topics", {}),
        await post(rpc(3, "resources/read", { uri: `quiz://questions/${id}` })),
        await post(rpc(4, "resources/list", {})),
        await post(rpc(5, "resources/templates/list", {})),
      ];
      for (const res of responses) {
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toContain("result");
        expect(text).not.toMatch(LEAK);
      }
      // The labels are present, so the check above is not vacuous.
      const q = await (await callTool("get_question", { questionId: id })).text();
      expect(q).toContain("MARKER-1B");
    });

    it("check_answer is the only place that reveals the correct option", async () => {
      const qid = questionId(db, "TEST question 1?");
      const rows = db
        .prepare("SELECT id, is_correct FROM options WHERE question_id = ?")
        .all(qid) as { id: number; is_correct: number }[];
      const right = rows.find((r) => r.is_correct === 1);
      const wrong = rows.find((r) => r.is_correct === 0);
      if (!right || !wrong) throw new Error("fixture");

      const ok = await (
        await callTool("check_answer", { questionId: qid, optionId: right.id })
      ).text();
      expect(ok).toContain('\\"correct\\":true');
      expect(ok).toContain(`\\"correctOptionId\\":${right.id}`);

      const bad = await (
        await callTool("check_answer", { questionId: qid, optionId: wrong.id })
      ).text();
      expect(bad).toContain('\\"correct\\":false');
      expect(bad).toContain(`\\"correctOptionId\\":${right.id}`);
    });
  });
});
