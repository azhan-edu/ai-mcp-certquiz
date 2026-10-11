import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPrompts } from "./prompts/index.js";
import { registerResources } from "./resources/index.js";
import type { QuizService } from "./services/quiz.js";
import { registerTools } from "./tools/index.js";

const SERVER_NAME = "certquiz";
const SERVER_VERSION = "0.1.0";

const INSTRUCTIONS =
  "Quiz flow: get_question, then wait for the user to choose an option, then check_answer. Call get_explanation or get_short_notes only when the user asks for them. Never call check_answer or get_explanation before the user has answered.";

export function createServer(service: QuizService): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );
  registerTools(server, service);
  registerResources(server, service);
  registerPrompts(server);
  return server;
}
