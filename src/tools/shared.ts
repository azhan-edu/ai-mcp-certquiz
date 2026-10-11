import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { NotFoundError } from "../lib/errors.js";
import { createLogger } from "../lib/logger.js";

const logger = createLogger();

function errorResult(text: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text }] };
}

/** Returns a validation failure (bad argument combination) as a tool error. */
export function toolInputError(message: string): CallToolResult {
  return errorResult(message);
}

/** Maps a service error to a tool error result without internals (no stack, paths or SQL). */
export function toolError(error: unknown, tool: string): CallToolResult {
  if (error instanceof NotFoundError) return errorResult(error.message);
  // Log only the error and the tool name (no tokens, no option data).
  logger.error({ err: error, tool }, "tool call failed");
  return errorResult("Internal error");
}

/** Runs a service call and mirrors the result in `structuredContent` and text content. */
export function toolJson<T extends Record<string, unknown>>(
  tool: string,
  load: () => T,
): CallToolResult {
  let data: T;
  try {
    data = load();
  } catch (error) {
    return toolError(error, tool);
  }
  return { structuredContent: data, content: [{ type: "text", text: JSON.stringify(data) }] };
}
