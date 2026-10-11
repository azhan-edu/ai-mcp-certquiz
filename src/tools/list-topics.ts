import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { QuizService } from "../services/quiz.js";
import { toolJson } from "./shared.js";

const topicSchema = z.object({
  id: z.number().int().describe("Topic id to pass as topicId to get_question"),
  name: z.string().describe("Topic name"),
});

const outputSchema = {
  topics: z.array(topicSchema).describe("All available topics"),
};

export function registerListTopicsTool(server: McpServer, service: QuizService): void {
  server.registerTool(
    "list_topics",
    {
      title: "List topics",
      description:
        "Lists the quiz topics as {topics[{id, name}]}. Use it only when the user asks which topics exist or names a topic and you need its id for get_question. Not needed to start a quiz: get_question works without a topic. Contains no questions or answers.",
      inputSchema: {},
      outputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    () =>
      toolJson("list_topics", () => ({
        topics: service.listTopics().map(({ id, name }) => ({ id, name })),
      })),
  );
}
