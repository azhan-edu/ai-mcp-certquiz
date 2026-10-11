import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { parseId } from "../lib/ids.js";
import { userMessage } from "./shared.js";

export function registerGetQuestionPrompt(server: McpServer): void {
  server.registerPrompt(
    "get_question",
    {
      title: "Get question",
      description: "Ask for a random quiz question, optionally from one topic.",
      argsSchema: {
        topicId: z
          .string()
          .optional()
          .describe('OPTIONAL positive integer topic id, e.g. "3". Omit for any topic'),
      },
    },
    ({ topicId }) => {
      const scope =
        topicId === undefined || topicId === ""
          ? "Call the get_question tool without arguments to get a random question."
          : `Call the get_question tool with topicId ${parseId(topicId, "topic")} to get a random question from that topic.`;
      return userMessage(
        `${scope} Show the question text and all answer options exactly as returned, including their option ids. Do not guess, hint at or reveal the answer: only the check_answer tool knows it. Then ask me to pick an option.`,
      );
    },
  );
}
