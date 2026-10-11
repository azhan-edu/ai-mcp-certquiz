---
paths:
  - "tests/**"
  - "**/*.test.ts"
---

# Testing rules

- Vitest for unit and integration tests; layout is `tests/unit/` and `tests/integration/`.
- Database in tests: `new DatabaseSync(":memory:")` with the schema loaded from `schema.sql`. Never touch the real DB file.
- Protocol: SDK `Client` + `InMemoryTransport.createLinkedPair()`.
- HTTP: start the server on port `0` and use `fetch`/`supertest`. Cover 401 without a token, `/health` and stateless behavior.
- **Mandatory invariant test:** the result of `get_question` and the question resources contain no `is_correct` (or equivalent); `check_answer` tells correct from incorrect answers.
- Tests are independent and deterministic: no order dependence, no network, no real clock or randomness (stub it or assert a property).
- Test behavior, not implementation. Never weaken or delete an assertion to get a green run; if code is wrong, report the bug.
- Test data is clearly marked fake data, not real exam questions.

```ts
// right: asserts the invariant on the whole payload
expect(JSON.stringify(result)).not.toMatch(/is_?correct/i);

// wrong: checks a single field and misses leaks elsewhere
expect(result.structuredContent.question.isCorrect).toBeUndefined();
```
