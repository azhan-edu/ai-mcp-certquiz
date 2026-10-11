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
    .describe(
      "OPTIONAL. If given, the tool returns this specific question. If omitted, a RANDOM question is returned. Pass it only when the user or an earlier result supplied a real question id; never invent one. Cannot be combined with topicId",
    ),
  topicId: z
    .number()
    .int()
    .positive()
    .safe()
    .optional()
    .describe(
      "OPTIONAL. Only narrows the random choice to one topic; omit for any topic. Cannot be combined with questionId",
    ),
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
        "Returns a quiz question with its answer options. questionId is OPTIONAL: if questionId is given, returns that specific question; if it is omitted, returns a RANDOM question. Pass questionId only when the user or an earlier result supplied a real question id; otherwise omit it. topicId (optional) only narrows the random choice and cannot be combined with questionId. Does not reveal the correct option; use check_answer for that.",
      inputSchema,
      outputSchema,
      annotations: { readOnlyHint: true },
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
