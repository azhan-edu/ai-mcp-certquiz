---
paths:
  - "src/http.ts"
  - "src/index.ts"
  - "src/config.ts"
  - "src/lib/**"
---

# HTTP, config and security rules

- Streamable HTTP runs stateless (`sessionIdGenerator: undefined`); `createServer()` is called per request and the server keeps no user state.
- Authenticate `/mcp` with `Authorization: Bearer <MCP_AUTH_TOKEN>`; compare with `crypto.timingSafeEqual` after checking lengths. Missing or wrong token returns 401.
- Validate `Origin` and `Host` to prevent DNS rebinding. Bind to loopback by default. Provide `/health` that reveals no internal state.
- Configuration comes only from `config.ts` (zod over `process.env`) and fails fast at startup with a clear error. Do not read `process.env` anywhere else.
- Logging uses pino to stderr (stdout is reserved for the protocol where applicable). Configure `redact` for `authorization` and token fields. Never log request bodies or the token.
- Secrets live in `.env` (git-ignored). Keep `.env.example` with placeholders only.
- Error responses carry no stack traces, paths or SQL.

```ts
// right
const a = Buffer.from(provided);
const b = Buffer.from(expected);
const ok = a.length === b.length && timingSafeEqual(a, b);

// wrong: timing side channel
const ok = provided === expected;
```
