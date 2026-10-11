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
        "Lists the available quiz topics (id and name). Use a topic id as topicId in get_question to get a random question from that topic. Contains no questions or answers.",
      inputSchema: {},
      outputSchema,
      annotations: { readOnlyHint: true },
    },
    () =>
      toolJson("list_topics", () => ({
        topics: service.listTopics().map(({ id, name }) => ({ id, name })),
      })),
  );
}
