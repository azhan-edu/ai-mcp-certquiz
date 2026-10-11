import { type McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { QuizService } from "../services/quiz.js";
import { parseId, readJson } from "./shared.js";

export function registerTopicResource(server: McpServer, service: QuizService): void {
  server.registerResource(
    "topic",
    new ResourceTemplate("quiz://topics/{id}", { list: undefined }),
    {
      title: "Quiz topic",
      description: "A quiz topic (category) by id: JSON {id, name}.",
      mimeType: "application/json",
    },
    (uri, { id }) => {
      const topicId = parseId(id, "topic");
      return readJson(uri, () => service.getTopic(topicId));
    },
  );
}
