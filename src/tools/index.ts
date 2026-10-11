import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { QuizService } from "../services/quiz.js";
import { registerCheckAnswerTool } from "./check-answer.js";
import { registerGetExplanationTool } from "./get-explanation.js";
import { registerGetQuestionTool } from "./get-question.js";
import { registerGetShortNotesTool } from "./get-short-notes.js";
import { registerListTopicsTool } from "./list-topics.js";

export function registerTools(server: McpServer, service: QuizService): void {
  registerListTopicsTool(server, service);
  registerGetQuestionTool(server, service);
  registerCheckAnswerTool(server, service);
  registerGetExplanationTool(server, service);
  registerGetShortNotesTool(server, service);
}
