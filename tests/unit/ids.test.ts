import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { parseId } from "../../src/lib/ids.js";

describe("parseId", () => {
  it.each([
    ["1", 1],
    ["42", 42],
    ["9007199254740991", Number.MAX_SAFE_INTEGER],
  ])("parses %j", (raw, expected) => {
    expect(parseId(raw, "question")).toBe(expected);
  });

  it("takes the first element of an array", () => {
    expect(parseId(["7", "8"], "question")).toBe(7);
  });

  it.each([
    undefined,
    "",
    "0",
    "-1",
    "abc",
    "1.5",
    "1e3",
    "01",
    " 1",
    "1 ",
    "+1",
    "9007199254740992",
    "99999999999999999999",
  ])("rejects %j with InvalidParams naming the entity", (raw) => {
    let error: unknown;
    try {
      parseId(raw, "topic");
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(McpError);
    expect((error as McpError).code).toBe(ErrorCode.InvalidParams);
    expect((error as McpError).message).toContain("topic");
  });

  it("rejects an empty array", () => {
    expect(() => parseId([], "question")).toThrow(McpError);
  });
});
