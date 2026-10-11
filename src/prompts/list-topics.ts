import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { userMessage } from "./shared.js";

export function registerListTopicsPrompt(server: McpServer): void {
  server.registerPrompt(
    "list_topics",
    {
      title: "List topics",
      description: "List the available quiz topics.",
    },
    () =>
      userMessage(
        "Call the list_topics tool and show the topics exactly as returned, with their ids, so I can choose one.",
      ),
  );
}
