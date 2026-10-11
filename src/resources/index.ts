import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { QuizService } from "../services/quiz.js";
import { registerQuestionResource } from "./questions.js";
import { registerShortNotesResource } from "./short-notes.js";
import { registerTopicResource } from "./topics.js";

export function registerResources(server: McpServer, service: QuizService): void {
  registerTopicResource(server, service);
  registerQuestionResource(server, service);
  registerShortNotesResource(server, service);
}
