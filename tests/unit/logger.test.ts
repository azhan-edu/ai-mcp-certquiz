import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "../../src/lib/logger.js";

function capture(): { stream: Writable; output: () => string } {
  let buf = "";
  const stream = new Writable({
    write(chunk, _enc, cb) {
      buf += chunk.toString();
      cb();
    },
  });
  return { stream, output: () => buf };
}

describe("createLogger", () => {
  it("masks tokens and authorization headers", () => {
    const { stream, output } = capture();
    const log = createLogger("info", stream);
    const secret = "super-secret-token-123";
    log.info({
      req: { headers: { authorization: `Bearer ${secret}` } },
      config: { authToken: secret },
      token: secret,
      MCP_AUTH_TOKEN: secret,
    });
    expect(output()).not.toContain(secret);
    expect(output()).toContain("[Redacted]");
  });
});
