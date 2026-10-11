import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const ID_PATTERN = /^[1-9]\d*$/;
const idSchema = z.number().int().positive().safe().describe("Positive integer id");

/** Parses a string id (URI variable or prompt argument); a bad value becomes an InvalidParams error. */
export function parseId(value: string | string[] | undefined, what: string): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = idSchema.safeParse(
    raw !== undefined && ID_PATTERN.test(raw) ? Number(raw) : Number.NaN,
  );
  if (!parsed.success) {
    throw new McpError(ErrorCode.InvalidParams, `Invalid ${what} id: expected a positive integer`);
  }
  return parsed.data;
}
