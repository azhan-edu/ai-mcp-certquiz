import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { parseId } from "../lib/ids.js";
import { idArg, userMessage } from "./shared.js";

export function registerGetQuestionNotesPrompt(server: McpServer): void {
  server.registerPrompt(
    "get_question_notes",
    {
      title: "Get question notes",
      description:
        "Show the short study notes for a quiz question (uses the get_short_notes tool).",
      argsSchema: { questionId: idArg("question") },
    },
    ({ questionId }) =>
      userMessage(
        `Call the get_short_notes tool with questionId ${parseId(questionId, "question")} and show all notes exactly as returned, without rewriting or adding to them.`,
      ),
  );
}
