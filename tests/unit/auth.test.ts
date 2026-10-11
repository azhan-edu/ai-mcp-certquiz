import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { bearerAuth } from "../../src/auth.js";

// TEST DATA ONLY: fake token.

const crypto = vi.hoisted(() => ({ tse: vi.fn<(a: Buffer, b: Buffer) => boolean>() }));

// Partial mock: keep real behavior, but record timingSafeEqual calls.
vi.mock("node:crypto", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:crypto")>();
  crypto.tse.mockImplementation(original.timingSafeEqual);
  return { ...original, timingSafeEqual: crypto.tse };
});

const TOKEN = "unit-token-not-a-secret";

function run(authorization: unknown) {
  const headers: Record<string, unknown> = {};
  if (authorization !== undefined) headers.authorization = authorization;
  const res = {
    setHeader: vi.fn(),
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  const next = vi.fn();
  bearerAuth(TOKEN)(
    { headers } as unknown as Request,
    res as unknown as Response,
    next as NextFunction,
  );
  return { res, next };
}

describe("bearerAuth", () => {
  it("calls next() for the exact token", () => {
    const { res, next } = run(`Bearer ${TOKEN}`);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it.each(["bearer", "BEARER", "BeArEr"])("accepts scheme %s", (scheme) => {
    const { next } = run(`${scheme} ${TOKEN}`);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["no header", undefined],
    ["empty header", ""],
    ["wrong token", "Bearer nope"],
    ["empty token", "Bearer "],
    ["scheme only", "Bearer"],
    ["wrong scheme", `Basic ${TOKEN}`],
    ["bare token", TOKEN],
    ["extra whitespace", `Bearer  ${TOKEN}`],
    ["trailing whitespace", `Bearer ${TOKEN} `],
    ["longer token", `Bearer ${TOKEN}x`],
    ["prefix of token", `Bearer ${TOKEN.slice(0, -1)}`],
    ["array header", [`Bearer ${TOKEN}`]],
  ])("rejects: %s", (_name, header) => {
    const { res, next } = run(header);
    expect(next).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith("WWW-Authenticate", "Bearer");
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized." },
      id: null,
    });
  });

  it("uses timingSafeEqual on equal-length buffers, even without a header", () => {
    crypto.tse.mockClear();
    run(undefined);
    run("Bearer short");
    run(`Bearer ${TOKEN}`);
    expect(crypto.tse).toHaveBeenCalledTimes(3);
    for (const [a, b] of crypto.tse.mock.calls) {
      expect(a.length).toBe(b.length);
    }
  });
});
