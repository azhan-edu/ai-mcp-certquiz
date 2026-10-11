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
import { createQuizService } from "../../src/services/quiz.js";
import { richFixture, seedData } from "../helpers/seed-json.js";

// TEST DATA ONLY: synthetic fixtures and fake tokens, not real exam content or secrets.

vi.mock("../../src/lib/logger.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/lib/logger.js")>();
  return {
    ...original,
    createLogger: (level?: string, destination?: Parameters<typeof original.createLogger>[1]) =>
      destination ? original.createLogger(level, destination) : original.createLogger("silent"),
  };
});

const TOKEN = "test-token-not-a-secret";
const WRONG = "wrong-token-marker-xyz";
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
const LIST = { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} };
const UNAUTHORIZED = {
  jsonrpc: "2.0",
  error: { code: -32001, message: "Unauthorized." },
  id: null,
};

describe("Bearer auth over HTTP", () => {
  let db: DatabaseSync;
  let server: Server;
  let base: string;
  let logLines: string[];
  const clients: Client[] = [];

  beforeEach(async () => {
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    importSeedData(db, seedData(richFixture()));
    logLines = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        logLines.push(...String(chunk).split("\n").filter(Boolean));
        cb();
      },
    });
    const app = createApp({
      service: createQuizService(createRepository(db)),
      logger: createLogger("info", sink),
      authToken: TOKEN,
    });
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    for (const c of clients.splice(0)) await c.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  });

  const post = (body: unknown, authorization?: string) =>
    fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: ACCEPT,
        ...(authorization === undefined ? {} : { authorization }),
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  /** Raw request so a GET/DELETE can carry a body without a token. */
  const raw = (method: string, headers: Record<string, string>, body: string) =>
    new Promise<{ status: number; text: string }>((resolve, reject) => {
      const req = request(`${base}/mcp`, { method, headers }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => {
          text += c;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
      });
      req.on("error", reject);
      req.end(body);
    });

  describe("missing or invalid credentials", () => {
    it("POST /mcp without Authorization returns 401 with challenge and JSON-RPC body", async () => {
      const res = await post(INIT);
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toBe("Bearer");
      expect(await res.json()).toEqual(UNAUTHORIZED);
    });

    const bad: [string, string][] = [
      ["wrong token", `Bearer ${WRONG}`],
      ["wrong scheme", "Basic dXNlcjpwYXNz"],
      ["scheme only, no token", "Bearer"],
      ["empty token", "Bearer "],
      ["extra leading whitespace", `Bearer  ${TOKEN}`],
      ["longer token", `Bearer ${TOKEN}x`],
      ["shorter token", `Bearer ${TOKEN.slice(0, 3)}`],
      ["prefix of real token", `Bearer ${TOKEN.slice(0, -1)}`],
      ["token without scheme", TOKEN],
      ["token with wrong case", `Bearer ${TOKEN.toUpperCase()}`],
    ];

    it.each(bad)("%s gets 401", async (_name, header) => {
      const res = await post(INIT, header);
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toBe("Bearer");
      expect(await res.json()).toEqual(UNAUTHORIZED);
    });

    it("all rejections share one body (no oracle)", async () => {
      const bodies = new Set<string>();
      for (const [, header] of bad) bodies.add(await (await post(INIT, header)).text());
      bodies.add(await (await post(INIT)).text());
      expect(bodies.size).toBe(1);
    });
  });

  describe("valid credentials", () => {
    it.each([`Bearer ${TOKEN}`, `bearer ${TOKEN}`, `BEARER ${TOKEN}`])(
      "scheme is case-insensitive: %s",
      async (header) => {
        const init = await post(INIT, header);
        expect(init.status).toBe(200);
        await init.text();
        const list = await post(LIST, header);
        expect(list.status).toBe(200);
        expect(await list.text()).toContain("get_question");
      },
    );

    it("a real SDK client initializes and lists tools", async () => {
      const client = new Client({ name: "auth-test", version: "0.0.0" });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
          requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
        }),
      );
      clients.push(client);
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toContain("check_answer");
    });

    it("an SDK client without a token fails to connect", async () => {
      const client = new Client({ name: "auth-test", version: "0.0.0" });
      await expect(
        client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`))),
      ).rejects.toMatchObject({ code: 401 });
      await client.close();
    });
  });

  describe("methods", () => {
    it.each(["GET", "DELETE"])("%s /mcp without token is 401, not 405", async (method) => {
      const res = await fetch(`${base}/mcp`, { method, headers: { accept: ACCEPT } });
      expect(res.status).toBe(401);
      expect(res.headers.get("allow")).toBeNull();
      expect(await res.json()).toEqual(UNAUTHORIZED);
    });

    it.each(["GET", "DELETE"])("%s /mcp with token is 405", async (method) => {
      const res = await fetch(`${base}/mcp`, {
        method,
        headers: { accept: ACCEPT, authorization: `Bearer ${TOKEN}` },
      });
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
    });
  });

  describe("auth runs before the body parser", () => {
    it("malformed JSON without token is 401, not 400", async () => {
      const res = await post('{"jsonrpc": "2.0", broken');
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual(UNAUTHORIZED);
    });

    it("malformed JSON with a wrong token is 401", async () => {
      const res = await post("{broken", `Bearer ${WRONG}`);
      expect(res.status).toBe(401);
    });

    it("oversized body without token is 401, not 413", async () => {
      const body = JSON.stringify({ ...LIST, params: { pad: "a".repeat(150_000) } });
      const res = await raw("POST", { "content-type": "application/json", accept: ACCEPT }, body);
      expect(res.status).toBe(401);
      expect(JSON.parse(res.text)).toEqual(UNAUTHORIZED);
    });

    it("oversized body with a valid token is still 413", async () => {
      const body = JSON.stringify({ ...LIST, params: { pad: "a".repeat(150_000) } });
      const res = await post(body, `Bearer ${TOKEN}`);
      expect(res.status).toBe(413);
    });
  });

  describe("public routes", () => {
    it("/health is 200 without a token", async () => {
      const res = await fetch(`${base}/health`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "ok" });
    });
  });

  describe("logs", () => {
    it("401s log method, path, status, durationMs and never the token or header", async () => {
      await (await post(INIT, `Bearer ${WRONG}`)).text();
      await (await post(INIT)).text();
      await vi.waitFor(() => expect(logLines.length).toBeGreaterThanOrEqual(2));

      const entries = logLines.map((l) => JSON.parse(l) as Record<string, unknown>);
      const e401 = entries.find((e) => e.status === 401);
      expect(e401).toMatchObject({ method: "POST", path: "/mcp", status: 401 });
      expect(typeof e401?.durationMs).toBe("number");

      const all = logLines.join("\n");
      expect(all).not.toContain(TOKEN);
      expect(all).not.toContain(WRONG);
      expect(all).not.toContain(`Bearer ${WRONG}`);
      expect(all.toLowerCase()).not.toContain("authorization");
    });
  });

  describe("invariant", () => {
    it("a 401 body reveals no tool names, options or answer data", async () => {
      const text = await (await post(LIST)).text();
      expect(text).not.toMatch(
        /get_question|check_answer|list_topics|tools|options|is_?correct|correctOptionId|quiz:\/\//i,
      );
      expect(text).not.toContain(TOKEN);
    });
  });
});
