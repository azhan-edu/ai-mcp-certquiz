import { type McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { QuizService } from "../services/quiz.js";
import { parseId, readJson } from "./shared.js";

export function registerQuestionResource(server: McpServer, service: QuizService): void {
  server.registerResource(
    "question",
    new ResourceTemplate("quiz://questions/{id}", {
      list: () => ({
        resources: service.listQuestionIds().map((id) => ({
          uri: `quiz://questions/${id}`,
          name: `Question ${id}`,
          mimeType: "application/json",
        })),
      }),
    }),
    {
      title: "Quiz question",
      description:
        "A quiz question by id: JSON {id, text, options:[{id, label}]}. Does not reveal the correct option.",
      mimeType: "application/json",
    },
    (uri, { id }) => {
      const questionId = parseId(id, "question");
      return readJson(uri, () => service.getQuestion(questionId));
    },
  );
}
