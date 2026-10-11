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
        "Checks the chosen option of a question and returns whether it is correct together with the id of the correct option. Flow: list_topics (optional) -> get_question -> check_answer -> get_explanation / get_short_notes on request. This is the ONLY tool that reveals the correct option, so call it only after the user has chosen an answer. Unknown question or option returns an error.",
      inputSchema,
      outputSchema,
      annotations: { readOnlyHint: true },
    },
    ({ questionId, optionId }) =>
      toolJson("check_answer", () => {
        const result = service.checkAnswer(questionId, optionId);
        return { correct: result.correct, correctOptionId: result.correctOptionId };
      }),
  );
}
