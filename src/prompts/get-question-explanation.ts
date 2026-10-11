import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { parseId } from "../lib/ids.js";
import { idArg, userMessage } from "./shared.js";

export function registerGetQuestionExplanationPrompt(server: McpServer): void {
  server.registerPrompt(
    "get_question_explanation",
    {
      title: "Get question explanation",
      description:
        "Show the stored explanation for a quiz question (uses the get_explanation tool).",
      argsSchema: { questionId: idArg("question") },
    },
    ({ questionId }) =>
      userMessage(
        `Call the get_explanation tool with questionId ${parseId(questionId, "question")} and show the explanation exactly as returned, without rewriting or adding to it.`,
      ),
  );
}
