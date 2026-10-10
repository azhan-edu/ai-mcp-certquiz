---
paths:
  - "src/tools/**"
  - "src/resources/**"
  - "src/server.ts"
---

# MCP tools and resources rules

- Tools and resources are thin adapters: parse input, call `src/services/quiz.ts`, shape the result. No business logic and no SQL here.
- Register with `registerTool` / `registerResource` / `ResourceTemplate`. Every input and output field has a zod schema with `.describe()`; mirror the result in `structuredContent`.
- Every tool sets `annotations: { readOnlyHint: true }`.
- Return failures as `isError: true` with a short, human-readable message. No stack traces, file paths or SQL in messages.
- **Invariant: only `check_answer` knows which option is correct.** `get_random_question`, `list_topics` and the question resources never expose `is_correct`, `correctOptionId` or any equivalent.
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
