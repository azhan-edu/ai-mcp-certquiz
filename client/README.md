# client: agent working folder for certquiz

`client/` is a ready-made working folder for a coaching agent. The files inside configure the agent to use the certquiz MCP service: role and rules, connection, permissions and token. An agent started from this folder is ready to run a quiz right away.

The configuration is for Claude Code. Plan: [docs/plan.client.md](../docs/plan.client.md).

**Two ways to use the folder:**
- **Copy it as a template** into a separate directory and run the agent there. **Preferred, best option:** the agent is fully isolated from the repository, does not see the root `CLAUDE.md`, skills or maintainer commands, and has no access to the answer key. After copying, fix the `../` paths in `permissions.deny` and the server URL in `.mcp.json` (see "Limitations").
- **Run it right here:** `cd client && claude`. A quick path for development and checks, but isolation is provided only by the `deny` rules.

## What it consists of

| File | What it configures | Plan item |
|---|---|---|
| `CLAUDE.md` | **Behavior:** coach role, flow, how to show results, prohibitions | 1, 2, 7 |
| `.mcp.json` | **Connection:** server address `http://127.0.0.1:3000/mcp`, token from an environment variable | 5 |
| `.claude/settings.json` | **Parameters and permissions:** auto-approval, tool loading, allow/deny. See [below](#claudesettingsjson-parameters) | 3, 4 |
| `.claude/settings.local.json` | **Personal secret:** the `MCP_AUTH_TOKEN` token, not in git. Each user creates their own | 5 |
| `.env.example` | Hint: the name of the `MCP_AUTH_TOKEN` variable | 5 |
| `.gitignore` | Keeps `.env` and `settings.local.json` out of git | 5 |

## Quick start
1. Set up the token (section below): once on the server, once in the client.
2. In the project root: `npm run dev` (server on `127.0.0.1:3000`).
3. `cd client && claude`.
4. Write "Give me a question".

## Token: create, register on the server, set in the client

The server and the client share one secret. The client sends it in the `Authorization: Bearer <token>` header, the server compares it with its own and answers 401 on a mismatch.

### 1. Generate
```bash
openssl rand -hex 32
```
This gives a 64-character string. Server requirements: at least 32 characters and not the placeholder from `.env.example`, otherwise the server does not start. Never commit the token.

### 2. Register on the server
In the **project root** (not in `client/`):
```bash
cp .env.example .env        # if .env does not exist yet
```
Open `.env` and set:
```
MCP_AUTH_TOKEN=<generated token>
```
Restart the server (`npm run dev`): the token is read at startup. `.env` is not committed to git.

### 3. Set it in the client
Pick one way; the value is the same everywhere.

**A. File `client/.claude/settings.local.json` (recommended, the token is stored once):**
```json
{ "env": { "MCP_AUTH_TOKEN": "<same token>" } }
```
The file is already in `client/.gitignore`. Nothing to change in `.mcp.json`: it contains `Bearer ${MCP_AUTH_TOKEN}`. The file currently holds the placeholder `replace-with-your-token`; with it the server answers 401.

**B. Shell environment variable (fallback):**
```bash
export MCP_AUTH_TOKEN=<same token>
cd client && claude
```
Applies only to this terminal. If it is set both in the shell and in `settings.local.json`, the values must match.

### 4. Verify
- Server: `curl -i http://127.0.0.1:3000/mcp` without a token should return `401`, and `curl http://127.0.0.1:3000/health` should return `200`.
- Client: in `claude`, the `/mcp` command shows `certquiz` as `connected`. A connection error or 401 means the tokens differ, the placeholder `replace-with-your-token` is still there, or the server was not restarted after changing `.env`.
- Changing the token: update it in the server `.env` and in the client, then restart both.

Not verified: whether `env` from the settings is substituted into `.mcp.json` when connecting. If `/mcp` shows an error, use way B.

## `.claude/settings.json` parameters

| Parameter | Value | What it does |
|---|---|---|
| `enableAllProjectMcpServers` | `true` | Automatically approves all MCP servers from `.mcp.json`, so there is no trust prompt for `certquiz` on first launch. It applies to any servers added to that file later. More precise: `"enabledMcpjsonServers": ["certquiz"]`. |
| `env.ENABLE_TOOL_SEARCH` | `"false"` | Turns off deferred loading of MCP tools. Names, descriptions and schemas of all 5 tools go into the context immediately and stay there for the whole session; the agent spends no turn searching for a tool. Check with `/context` or `/mcp`. |
| `permissions.allow` | `mcp__certquiz__*` | Calls to certquiz tools run without a confirmation prompt (all of them are `readOnlyHint`). |
| `permissions.deny` | web, `Bash`, `Write`, `Edit`, `Read(../raw-data/**)`, `../data/**`, `../.env`, `../src/**` | Leaves the agent only certquiz and blocks reading the answer key. |

## How `settings.local.json` affects the other parameters
- **Precedence.** `settings.local.json` is read on top of `settings.json`. Matching keys come from local, objects such as `env` are merged, and the `permissions.allow` and `deny` arrays are combined from both files. `deny` beats `allow`, so a permission added in local does not lift the prohibitions from `settings.json`.
- **Token and `.mcp.json`.** This is the only link between the files: without a valid token `certquiz` will not connect, even though `enableAllProjectMcpServers` approved it and `permissions.allow` permits its tools.
- **Nothing else is affected.** `ENABLE_TOOL_SEARCH` and the `deny` rules work independently of local. Do not override them there if you need the answer protection.
- **What not to put in `settings.json`.** Keep the token only in local or in the shell, otherwise it ends up in git.

## Limitations
- The folder lives inside the repository, so Claude Code also picks up the root `CLAUDE.md` with its skills. Protection from reading answers is provided by the `deny` rules in `settings.json`. For full isolation move `client/` out of the repository and remove `../` from the paths.
- Server prompts (`/get_question` etc.) appear as slash commands if the client shows them (plan item 6).
- If your client does not show the server `instructions`, the rules from `CLAUDE.md` still apply.
