import { type McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { parseId } from "../lib/ids.js";
import type { QuizService } from "../services/quiz.js";
import { readJson } from "./shared.js";

export function registerShortNotesResource(server: McpServer, service: QuizService): void {
  server.registerResource(
    "question-short-notes",
    new ResourceTemplate("quiz://questions/{id}/short-notes", {
      list: () => ({
        resources: service.listQuestionIds().map((id) => ({
          uri: `quiz://questions/${id}/short-notes`,
          name: `Short notes: question ${id}`,
          mimeType: "application/json",
        })),
      }),
    }),
    {
      title: "Question short notes",
      description:
        "Short notes of a question: JSON list of {id, title, text}; empty list when the question has none.",
      mimeType: "application/json",
    },
    (uri, { id }) => {
      const questionId = parseId(id, "question");
      return readJson(uri, () => service.listShortNotes(questionId));
    },
  );
}
