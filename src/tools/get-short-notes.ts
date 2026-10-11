import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { QuizService } from "../services/quiz.js";
import { toolJson } from "./shared.js";

const noteSchema = z.object({
  id: z.number().int().describe("Short note id"),
  title: z.string().describe("Short note title"),
  text: z.string().describe("Short note text"),
});

const inputSchema = {
  questionId: z
    .number()
    .int()
    .positive()
    .safe()
    .describe(
      "Id of the question whose short notes to return, taken from the id field of the get_question result",
    ),
};

const outputSchema = {
  questionId: z.number().int().describe("Id of the question the notes belong to"),
  notes: z.array(noteSchema).describe("Short notes for the question"),
};

export function registerGetShortNotesTool(server: McpServer, service: QuizService): void {
  server.registerTool(
    "get_short_notes",
    {
      title: "Get short notes",
      description:
        "Returns the short notes linked to a question as {questionId, notes[{id, title, text}]}: brief hints on how to approach or understand it. Safe to call at any time, including before the user answers; notes may hint at the answer but are not the full explanation (that is get_explanation). A question with no notes, or an unknown question, returns an error: tell the user there are no notes and do not retry.",
      inputSchema,
      outputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    ({ questionId }) =>
      toolJson("get_short_notes", () => ({
        questionId,
        notes: service
          .getShortNotes(questionId)
          .map(({ id, title, text }) => ({ id, title, text })),
      })),
  );
}
