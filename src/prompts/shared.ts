import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

/** Prompt arguments are always strings; the id is validated again by `parseId`. */
export const idArg = (what: string) =>
  z.string().describe(`Positive integer ${what} id, e.g. "12". Never invent one`);

/** Wraps instruction text into a single user message. Prompts carry no quiz data. */
export function userMessage(text: string): GetPromptResult {
  return { messages: [{ role: "user", content: { type: "text", text } }] };
}
