import { type McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { QuizService } from "../services/quiz.js";
import { parseId, readJson } from "./shared.js";

export function registerShortNotesResource(server: McpServer, service: QuizService): void {
  server.registerResource(
    "question-short-notes",
    new ResourceTemplate("quiz://questions/{id}/short-notes", { list: undefined }),
    {
      title: "Question short notes",
      description:
        "Short notes of a question: JSON list of {id, title, text}; empty list when the question has none.",
      mimeType: "application/json",
    },
    (uri, { id }) => {
      const questionId = parseId(id, "question");
      return readJson(uri, () => service.getShortNotes(questionId));
    },
  );
}
