import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { QuizService } from "../services/quiz.js";
import { toolInputError, toolJson } from "./shared.js";

const optionSchema = z.object({
  id: z.number().int().describe("Option id to pass to check_answer"),
  label: z.string().describe("Option text shown to the user"),
});

const inputSchema = {
  questionId: z
    .number()
    .int()
    .positive()
    .safe()
    .optional()
    .describe("Id of a specific question. Omit for a random one. Not together with topicId"),
  topicId: z
    .number()
    .int()
    .positive()
    .safe()
    .optional()
    .describe("Topic id from list_topics. Omit for any topic. Not together with questionId"),
};

const outputSchema = {
  id: z
    .number()
    .int()
    .describe("Question id to pass to check_answer and to the other tools that take a questionId"),
  text: z.string().describe("Question text"),
  options: z.array(optionSchema).describe("Answer options; does not reveal the correct one"),
};

export function registerGetQuestionTool(server: McpServer, service: QuizService): void {
  server.registerTool(
    "get_question",
    {
      title: "Get question",
      description:
        "Returns one quiz question as {id, text, options[{id, label}]}: a random one, or a specific one when questionId is given. Use it to start or continue a quiz. Show the text and options to the user and let them choose; do not hint at the answer. Pass questionId only if the user or an earlier result supplied it, never invent one; topicId only narrows the random choice. questionId and topicId together, or an unknown id, return an error. Does not reveal the correct option: to verify an answer use check_answer.",
      inputSchema,
      outputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ questionId, topicId }) => {
      if (questionId !== undefined && topicId !== undefined) {
        return toolInputError("Specify either questionId or topicId, not both");
      }
      return toolJson("get_question", () => {
        const question =
          questionId !== undefined
            ? service.getQuestion(questionId)
            : service.getRandomQuestion(topicId);
        // Explicit mapping: only these fields ever leave the service.
        return {
          id: question.id,
          text: question.text,
          options: question.options.map(({ id, label }) => ({ id, label })),
        };
      });
    },
  );
}
