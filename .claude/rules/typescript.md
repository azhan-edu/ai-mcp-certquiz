---
paths:
  - "src/**/*.ts"
  - "tests/**/*.ts"
---

# TypeScript rules

- ESM only (`"type": "module"`); relative imports carry the `.js` extension.
- `strict` and `noUncheckedIndexedAccess` are on: handle `undefined` from indexed access instead of asserting it away.
- No `any`. For unknown data use `unknown` and narrow it with zod or a type guard. Avoid `as` casts and non-null `!`.
- Validate data at the boundaries (env, HTTP input, tool input, `questions.json`) with zod; infer types from the schema with `z.infer` instead of declaring them twice.
- Prefer `node:` prefixed built-ins (`node:crypto`, `node:sqlite`).
- Throw `Error` subclasses from `src/lib/errors.ts`; never throw strings.

```ts
// right
import { getRandomQuestion } from "../services/quiz.js";
const first = rows[0];
if (!first) return undefined;

// wrong
import { getRandomQuestion } from "../services/quiz"; // missing .js
const first = rows[0]!; // hides a possible undefined
```
