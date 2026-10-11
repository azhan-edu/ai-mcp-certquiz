import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCheckAnswerPrompt } from "./check-answer.js";
import { registerGetQuestionPrompt } from "./get-question.js";
import { registerGetQuestionExplanationPrompt } from "./get-question-explanation.js";
import { registerGetQuestionNotesPrompt } from "./get-question-notes.js";
import { registerListTopicsPrompt } from "./list-topics.js";

/** Prompts are data-free instructions: no service or DB is passed in, by design. */
export function registerPrompts(server: McpServer): void {
  registerGetQuestionPrompt(server);
  registerCheckAnswerPrompt(server);
  registerGetQuestionExplanationPrompt(server);
  registerGetQuestionNotesPrompt(server);
  registerListTopicsPrompt(server);
}
