import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerResources } from "./resources/index.js";
import type { QuizService } from "./services/quiz.js";
import { registerTools } from "./tools/index.js";

const SERVER_NAME = "certsafary";
const SERVER_VERSION = "0.1.0";

export function createServer(service: QuizService): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerTools(server, service);
  registerResources(server, service);
  return server;
}
