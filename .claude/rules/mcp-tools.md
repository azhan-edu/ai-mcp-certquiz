---
paths:
  - "src/tools/**"
  - "src/resources/**"
  - "src/prompts/**"
  - "src/server.ts"
---

# MCP tools, resources and prompts rules

- Tools and resources are thin adapters: parse input, call `src/services/quiz.ts`, shape the result. No business logic and no SQL here.
- Register with `registerTool` / `registerResource` / `ResourceTemplate`. Every input and output field has a zod schema with `.describe()`; mirror the result in `structuredContent`.
- Every tool sets `annotations: { readOnlyHint: true, openWorldHint: false }`, plus `idempotentHint: true` except for `get_question` (random choice).
- The quiz flow lives in the server-level `instructions` (`src/server.ts`), not in a tool description. Descriptions say what, when to call, when not to (naming the neighbour tool), result fields and errors.
- Return failures as `isError: true` with a short, human-readable message. No stack traces, file paths or SQL in messages.
- **Invariant: only `check_answer` knows which option is correct.** `get_question`, `list_topics` and the question resources never expose `is_correct`, `correctOptionId` or any equivalent.
- Prompts (`src/prompts/`) are data-free instructions: one user message telling the client agent which tool to call and to show results verbatim. They never read the DB or the service, never contain or fetch an answer, and validate id arguments with `parseId` (`src/lib/ids.ts`).
- New tool: create `src/tools/<kebab-name>.ts`, register it in `src/tools/index.ts`, add a test in `tests/`.

```ts
// right: question shape has no correctness marker
const optionSchema = z.object({
  id: z.number().describe("Option id to pass to check_answer"),
  label: z.string().describe("Option text shown to the user"),
});

// wrong: leaks the answer to the client agent
const optionSchema = z.object({ id: z.number(), label: z.string(), isCorrect: z.boolean() });
```
