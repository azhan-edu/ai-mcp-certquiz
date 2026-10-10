import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { ConfigError } from "../../src/lib/errors.js";

describe("loadConfig", () => {
  it("throws ConfigError when MCP_AUTH_TOKEN is missing", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/MCP_AUTH_TOKEN/);
  });

  it("rejects blank token without leaking values", () => {
    const env = { MCP_AUTH_TOKEN: "   ", PORT: "abc-secret" };
    try {
      loadConfig(env);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const msg = (err as Error).message;
      expect(msg).toMatch(/MCP_AUTH_TOKEN/);
      expect(msg).toMatch(/PORT/);
      expect(msg).not.toContain("abc-secret");
    }
  });

  it("applies defaults", () => {
    expect(loadConfig({ MCP_AUTH_TOKEN: "t" })).toEqual({
      port: 3000,
      authToken: "t",
      dbPath: "data/certsafary.db",
      logLevel: "info",
    });
  });

  it("trims the token and parses PORT", () => {
    const c = loadConfig({ MCP_AUTH_TOKEN: " tok ", PORT: "8080" });
    expect(c.authToken).toBe("tok");
    expect(c.port).toBe(8080);
  });

  it.each(["abc", "0", "70000", "1.5"])("rejects invalid PORT %s", (port) => {
    expect(() => loadConfig({ MCP_AUTH_TOKEN: "t", PORT: port })).toThrow(/PORT/);
  });

  it("rejects invalid LOG_LEVEL", () => {
    expect(() => loadConfig({ MCP_AUTH_TOKEN: "t", LOG_LEVEL: "loud" })).toThrow(/LOG_LEVEL/);
  });
});
