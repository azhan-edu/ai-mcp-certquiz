import { describe, expect, it } from "vitest";
import { AUTH_TOKEN_PLACEHOLDER, loadConfig, loadDbPath } from "../../src/config.js";
import { ConfigError } from "../../src/lib/errors.js";

const TOKEN = "a".repeat(32);

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

  it("rejects a short token", () => {
    expect(() => loadConfig({ MCP_AUTH_TOKEN: "short" })).toThrow(/at least 32 characters/);
  });

  it("rejects a 31-character token and accepts 32", () => {
    expect(() => loadConfig({ MCP_AUTH_TOKEN: "a".repeat(31) })).toThrow(ConfigError);
    expect(loadConfig({ MCP_AUTH_TOKEN: "a".repeat(32) }).authToken).toBe("a".repeat(32));
  });

  it("rejects the example placeholder", () => {
    expect(() => loadConfig({ MCP_AUTH_TOKEN: AUTH_TOKEN_PLACEHOLDER })).toThrow(
      /example placeholder/,
    );
  });

  it("does not echo a rejected token in the error", () => {
    const secret = "sekret-short-value";
    for (const token of [secret, AUTH_TOKEN_PLACEHOLDER]) {
      try {
        loadConfig({ MCP_AUTH_TOKEN: token });
        expect.unreachable();
      } catch (err) {
        expect((err as Error).message).not.toContain(token);
      }
    }
  });

  it("applies defaults", () => {
    expect(loadConfig({ MCP_AUTH_TOKEN: TOKEN })).toEqual({
      host: "127.0.0.1",
      port: 3000,
      authToken: TOKEN,
      dbPath: "data/certquiz.db",
      logLevel: "info",
    });
  });

  it("trims the token and parses PORT", () => {
    const c = loadConfig({ MCP_AUTH_TOKEN: ` ${TOKEN} `, PORT: "8080" });
    expect(c.authToken).toBe(TOKEN);
    expect(c.port).toBe(8080);
  });

  it("trims HOST and accepts an override", () => {
    expect(loadConfig({ MCP_AUTH_TOKEN: TOKEN, HOST: " 0.0.0.0 " }).host).toBe("0.0.0.0");
  });

  it("rejects a blank HOST", () => {
    expect(() => loadConfig({ MCP_AUTH_TOKEN: TOKEN, HOST: "  " })).toThrow(/HOST/);
  });

  it.each(["abc", "0", "70000", "1.5"])("rejects invalid PORT %s", (port) => {
    expect(() => loadConfig({ MCP_AUTH_TOKEN: TOKEN, PORT: port })).toThrow(/PORT/);
  });

  it("rejects invalid LOG_LEVEL", () => {
    expect(() => loadConfig({ MCP_AUTH_TOKEN: TOKEN, LOG_LEVEL: "loud" })).toThrow(/LOG_LEVEL/);
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
