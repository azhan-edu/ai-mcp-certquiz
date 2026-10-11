import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { NotFoundError } from "../lib/errors.js";
import { createLogger } from "../lib/logger.js";

const logger = createLogger();

/** MCP spec code for "resource not found". */
const RESOURCE_NOT_FOUND = -32002;

const ID_PATTERN = /^[1-9]\d*$/;
const idSchema = z.number().int().positive().safe().describe("Positive integer id from the URI");

/** Parses the `{id}` URI variable; a bad value becomes an InvalidParams error. */
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

/** Runs a service read and maps failures to clear resource errors without internals. */
export function readJson(uri: URL, load: () => unknown): ReadResourceResult {
  let data: unknown;
  try {
    data = load();
  } catch (error) {
    if (error instanceof McpError) throw error;
    if (error instanceof NotFoundError) throw new McpError(RESOURCE_NOT_FOUND, error.message);
    // Log only the error and the resource path (no tokens, no option data).
    logger.error({ err: error, resource: uri.pathname }, "resource read failed");
    throw new McpError(ErrorCode.InternalError, "Failed to read resource");
  }
  return {
    contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data) }],
  };
}
