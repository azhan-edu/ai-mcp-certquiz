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
    .describe(
      "Id of the question being answered, taken from the id field of the get_question result",
    ),
  optionId: z
    .number()
    .int()
    .positive()
    .safe()
    .describe("Id of the chosen option, taken from options[].id of the get_question result"),
};

const outputSchema = {
  correct: z.boolean().describe("True when the chosen option is the correct one"),
  correctOptionId: z.number().int().describe("Id of the correct option of the question"),
};

export function registerCheckAnswerTool(server: McpServer, service: QuizService): void {
  server.registerTool(
    "check_answer",
    {
      title: "Check answer",
      description:
        "Checks the option the user chose and returns {correct, correctOptionId}. Call it once the user has given an answer, never to peek at the solution: this is the only tool that returns the correct option id. Both ids come from the get_question result. For the reasoning behind the answer use get_explanation. An unknown question, or an option that does not belong to the question, returns an error: ask the user to choose from the listed options.",
      inputSchema,
      outputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    ({ questionId, optionId }) =>
      toolJson("check_answer", () => {
        const result = service.checkAnswer(questionId, optionId);
        return { correct: result.correct, correctOptionId: result.correctOptionId };
      }),
  );
}
