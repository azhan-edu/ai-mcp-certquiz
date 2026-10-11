# Plan: configuring the client agent for certquiz

## Context
The agent connected to certquiz must run a quiz through the chain "question → check → explanation / note" and must not reveal the answer before `check_answer`. Part of the setup lives on the server side (tool descriptions, server `instructions`, see `docs/plan.tool-description-improvements.md`), part on the client side. This plan covers the client side.

## Proposals (from most to least important)

1. **System prompt (or `CLAUDE.md` / project instructions) with the role and flow.**
   In short: "You are an exam-prep coach. Serve questions only through `get_question`. Never name the correct answer yourself, only after `check_answer`. Give explanations and notes on request." The same paragraph goes into the server `instructions`; if the client does not show them to the model, keep it in the agent prompt.

2. **Rules for showing results.**
   - Show the question and options verbatim, numbered.
   - Map "option 3" to `options[].id`, not to the position in the list.
   - Add no hints and do not comment on options before the check.
   - After `check_answer`, say whether the answer is correct and name the correct option by its text, not only by id.

3. **Limit the toolset.**
   Give the agent only the 5 certquiz tools, with no overlapping ones (for example, no general web search). Fewer tools, more accurate selection.

4. **Auto-approve read-only tools.**
   All tools have `readOnlyHint`. In Claude Code, allow `mcp__certquiz__*` in `permissions.allow` so the quiz is not interrupted by confirmation prompts.

5. **Connection.**
   `.mcp.json` with `type: http`, URL `http://127.0.0.1:3000/mcp` and the header `Authorization: Bearer ${MCP_AUTH_TOKEN}`. Take the token from an environment variable; do not write it into the file.

6. **Prompts as commands (optional).**
   The client may show `/get_question`, `/check_answer` and the others as slash commands. Useful when a predictable call is needed instead of free-form phrasing.

7. **Keep it apart from maintainer skills.**
   Do not connect `/get-question-explanation` and the other maintainer commands to the agent that runs the quiz: they read the answer and bypass `check_answer`.

## What to prepare
- Ready-made snippets for items 1, 2, 4: the agent prompt, `.mcp.json`, `settings.json` (done in `client/`, see `client/README.md`).
- The target client is not chosen yet: Claude Code, Claude Desktop or a custom agent on the SDK. The snippets in `client/` target Claude Code.

## Verification
- Ambiguous phrases: "give me a hint" → `get_short_notes`, "why is that?" → `get_explanation` after `check_answer`, "which topics are there?" → `list_topics`.
- The agent does not name the correct option before `check_answer`, including when asked "just tell me the answer".
- The quiz runs without confirmation prompts on tool calls.
