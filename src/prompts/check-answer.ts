import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { parseId } from "../lib/ids.js";
import { idArg, userMessage } from "./shared.js";

export function registerCheckAnswerPrompt(server: McpServer): void {
  server.registerPrompt(
    "check_answer",
    {
      title: "Check answer",
      description: "Check my chosen option for a quiz question.",
      argsSchema: {
        questionId: idArg("question"),
        optionId: idArg("option"),
      },
    },
    ({ questionId, optionId }) => {
      const question = parseId(questionId, "question");
      const option = parseId(optionId, "option");
      return userMessage(
        `Call the check_answer tool with questionId ${question} and optionId ${option}. Tell me whether the answer is correct, using only the tool result. Do not state or guess the correct option yourself.`,
      );
    },
  );
}
