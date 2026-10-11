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
        "Returns short notes that help to understand a question. Can be called at any time when the user asks for notes; notes may hint at the answer. Returns an error if the question is unknown or has no notes.",
      inputSchema,
      outputSchema,
      annotations: { readOnlyHint: true },
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
