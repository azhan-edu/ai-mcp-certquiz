import { describe, expect, it } from "vitest";
import { loadConfig, loadDbPath } from "../../src/config.js";
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
      host: "127.0.0.1",
      port: 3000,
      authToken: "t",
      dbPath: "data/certquiz.db",
      logLevel: "info",
    });
  });

  it("trims the token and parses PORT", () => {
    const c = loadConfig({ MCP_AUTH_TOKEN: " tok ", PORT: "8080" });
    expect(c.authToken).toBe("tok");
    expect(c.port).toBe(8080);
  });

  it("trims HOST and accepts an override", () => {
    expect(loadConfig({ MCP_AUTH_TOKEN: "t", HOST: " 0.0.0.0 " }).host).toBe("0.0.0.0");
  });

  it("rejects a blank HOST", () => {
    expect(() => loadConfig({ MCP_AUTH_TOKEN: "t", HOST: "  " })).toThrow(/HOST/);
  });

  it.each(["abc", "0", "70000", "1.5"])("rejects invalid PORT %s", (port) => {
    expect(() => loadConfig({ MCP_AUTH_TOKEN: "t", PORT: port })).toThrow(/PORT/);
  });

  it("rejects invalid LOG_LEVEL", () => {
    expect(() => loadConfig({ MCP_AUTH_TOKEN: "t", LOG_LEVEL: "loud" })).toThrow(/LOG_LEVEL/);
  });
});

describe("loadDbPath", () => {
  it("defaults without requiring MCP_AUTH_TOKEN", () => {
    expect(loadDbPath({})).toBe("data/certquiz.db");
  });

  it("uses DB_PATH when set", () => {
    expect(loadDbPath({ DB_PATH: " /tmp/x.db " })).toBe("/tmp/x.db");
  });

  it("rejects a blank DB_PATH with a ConfigError", () => {
    expect(() => loadDbPath({ DB_PATH: "  " })).toThrow(ConfigError);
  });
});
