import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { QuizService } from "../services/quiz.js";
import { toolJson } from "./shared.js";

const inputSchema = {
  questionId: z
    .number()
    .int()
    .positive()
    .safe()
    .describe("Id of the question to explain, taken from the id field of the get_question result"),
};

const outputSchema = {
  questionId: z.number().int().describe("Id of the explained question"),
  explanation: z
    .string()
    .describe("Why the correct option is correct and why the other options are not"),
};

export function registerGetExplanationTool(server: McpServer, service: QuizService): void {
  server.registerTool(
    "get_explanation",
    {
      title: "Get explanation",
      description:
        "Returns the explanation of a question: why the correct option is correct and why the others are not. It reveals the answer. Call only after check_answer, and only when the user asks for an explanation. Unknown question returns an error.",
      inputSchema,
      outputSchema,
      annotations: { readOnlyHint: true },
    },
    ({ questionId }) =>
      toolJson("get_explanation", () => ({
        questionId,
        explanation: service.getExplanation(questionId),
      })),
  );
}
