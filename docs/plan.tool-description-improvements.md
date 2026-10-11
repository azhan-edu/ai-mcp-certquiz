# Plan: improve the description of the 5 certquiz tools

## Context
The guide `docs/mcp-tool-descriptions.md` requires: action + result, "when to call / not to call" naming the neighbour tool, returned fields, input format, behavior limits, errors, distinguishable similar tools, no system-prompt instructions, 2–5 sentences. Project description (`docs/service-description.md`): the invariant "only `check_answer` knows the answer", short notes can be read at any time, the explanation comes after the answer and on request.

## What is wrong now (src/tools/*.ts)
| Tool | Problem |
|---|---|
| `check_answer` | The whole flow `list_topics -> get_question -> ...` is baked into the description (a system-prompt-level instruction, rule 12); no boundary "for the explanation use `get_explanation`"; the error format is vague |
| `get_question` | Shouting (`OPTIONAL`, `RANDOM`), duplication between the description and the field descriptions; the result fields are not named; it does not say that the agent must show the options and not hint |
| `get_explanation` | No boundary with `get_short_notes` (both "help to understand the question"); it does not say that one text per question is returned |
| `get_short_notes` | "Short notes that help to understand a question" is vague, indistinguishable from the explanation; fields not named; it does not say what to do on the "no notes" error |
| `list_topics` | Good on the whole; no "when to call" (only if the user asks for topics or names a topic) |
| all | No `idempotentHint`/`openWorldHint`; the flow lives in the description of one tool instead of server-level `instructions` (`McpServer` is created without `instructions` at `src/server.ts:11`) |

## Proposed texts (EN, as in the code; template: what → when → when not → input/output → limits)

| Tool | Current description | New description | Why it is better |
|---|---|---|---|
| `list_topics` | Lists the available quiz topics (id and name). Use a topic id as topicId in get_question to get a random question from that topic. Contains no questions or answers. | Lists the quiz topics as {id, name}. Use it only when the user asks which topics exist or names a topic and you need its id for get_question. Not needed to start a quiz: get_question works without a topic. Contains no questions or answers. | Added "when to call" (only on request or to find a topic id) and "when not needed" (a quiz starts without a topic); the result fields {id, name} are named. The agent stops calling it before every question (rules 1–3). |
| `get_question` | Returns a quiz question with its answer options. questionId is OPTIONAL: if questionId is given, returns that specific question; if it is omitted, returns a RANDOM question. Pass questionId only when the user or an earlier result supplied a real question id; otherwise omit it. topicId (optional) only narrows the random choice and cannot be combined with questionId. Does not reveal the correct option; use check_answer for that. | Returns one quiz question as {id, text, options[{id, label}]}: a random one, or a specific one when questionId is given. Use it to start or continue a quiz. Show the text and options to the user and let them choose; do not hint at the answer. Pass questionId only if the user or an earlier result supplied it, never invent one; topicId only narrows the random choice. questionId and topicId together, or an unknown id, return an error. Does not reveal the correct option: to verify an answer use check_answer. | Removed the caps and the repeated field text; the result fields are named and it says to show the options without hints; errors are described explicitly (both arguments, unknown id) together with the boundary with `check_answer` (rules 1, 3, 5, 7). |
| `check_answer` | Checks the chosen option of a question and returns whether it is correct together with the id of the correct option. Flow: list_topics (optional) -> get_question -> check_answer -> get_explanation / get_short_notes on request. This is the ONLY tool that reveals the correct option, so call it only after the user has chosen an answer. Unknown question or option returns an error. | Checks the option the user chose and returns {correct, correctOptionId}. Call it once the user has given an answer, never to peek at the solution: this is the only tool that reveals the correct option. Both ids come from the get_question result. For the reasoning behind the answer use get_explanation. An unknown question, or an option that does not belong to the question, returns an error: ask the user to choose from the listed options. | The baked-in flow chain is removed (it is a system-prompt-level instruction, rule 12; it moves to the server `instructions`). Added: the result fields are named, "do not peek", the boundary with `get_explanation`, what to do on an error (rules 2, 3, 7). |
| `get_explanation` | Returns the explanation of a question: why the correct option is correct and why the others are not. It reveals the answer. Call only after check_answer, and only when the user asks for an explanation. Unknown question returns an error. | Returns the single stored explanation of a question: why the correct option is correct and why the others are not. It reveals the answer, so call it only after check_answer and only when the user asks for an explanation. For hints before answering use get_short_notes. An unknown question returns an error. | Added the boundary with `get_short_notes` (both "help to understand the question" and were indistinguishable, rule 9); clarified that there is one explanation per question (rule 5). |
| `get_short_notes` | Returns short notes that help to understand a question. Can be called at any time when the user asks for notes; notes may hint at the answer. Returns an error if the question is unknown or has no notes. | Returns the short notes linked to a question as [{id, title, text}]: brief hints on how to approach or understand it. Safe to call at any time, including before the user answers; notes may hint at the answer but are not the full explanation (that is get_explanation). A question with no notes, or an unknown question, returns an error: tell the user there are no notes and do not retry. | "Help to understand" is replaced with specifics: the fields [{id,title,text}], how a note differs from the explanation, whether it may be called before the answer; for the "no notes" error it says not to repeat the call (rules 3, 7, 9). |

Note: in the code the result shapes of `list_topics` and `get_short_notes` are written exactly as the tools return them: `{topics[{id, name}]}` and `{questionId, notes[{id, title, text}]}`, and `check_answer` says "the only tool that returns the correct option id" (the explanation text also names the correct option, but only on request, after the answer).

`get_question` field descriptions, removing the repetition from the description: `questionId`: "Id of a specific question. Omit for a random one. Not together with topicId"; `topicId`: "Topic id from list_topics. Omit for any topic. Not together with questionId".

## Cross-cutting changes
1. **Server-level `instructions`** in `src/server.ts` (`new McpServer(info, { instructions })`): one paragraph with the flow "get_question → the user answers → check_answer → get_explanation / get_short_notes on request; do not call check_answer/get_explanation before the answer". Remove the flow from `check_answer`. Check that `rules/mcp-tools.md` and the prompts do not conflict with it (prompts stay data-free).
2. **Annotations:** add `openWorldHint: false` to `readOnlyHint: true` on all tools, and `idempotentHint: true` on `list_topics`, `check_answer`, `get_explanation`, `get_short_notes` (not on `get_question`: random choice). Update `rules/mcp-tools.md` ("Every tool sets readOnlyHint…").
3. **Errors (optional, as a separate step):** the guide recommends `errorCategory`/`isRetryable`. For a small server I propose not to complicate things for now: the error texts in `toolError` are already human-readable, and "what to do" is in the description (above). Add the structured fields if a need appears.
4. **Invariant:** the descriptions contain no data and no answers; `check_answer` remains the only tool that returns `correctOptionId`.

## Files
- **First step** after leaving plan mode: save this plan as `docs/plan.description-improvements.md` (named after `docs/plan.github-actions.md`, `docs/plan.claude-files.md`); adding a link to `CLAUDE.md`/`docs/plan.md` is not needed, only the file
- `src/tools/{list-topics,get-question,check-answer,get-explanation,get-short-notes}.ts`: description, field descriptions, annotations
- `src/server.ts`: `instructions`
- `.claude/rules/mcp-tools.md`, `docs/service-description.md`: sync (annotations, instructions)
- `tests/integration/server.test.ts`: check that it does not depend on the old strings; add checks: every tool has a non-empty description and a description for every field, `annotations` are set, `instructions` is present, the descriptions do not contain the word `is_correct`

## Execution (per CLAUDE.md)
`mcp-developer` edits the tools and server.ts → `test-engineer` tests → `build-verifier` → `quiz-invariant-reviewer` + `code-reviewer` → `docs-writer`. Commit only when asked.

## Verification
- `npm run lint && npm run typecheck && npm test` (including the invariant test)
- `npm run inspect`: `tools/list` shows the new texts and annotations, `initialize` returns `instructions`
- Through a real client (`.mcp.json`), run the ambiguous phrases: "give me a hint" → `get_short_notes`, "why is that?" → `get_explanation` after `check_answer`, "question 12 from topic 2" → an error without invented arguments, "which topics are there?" → `list_topics`
