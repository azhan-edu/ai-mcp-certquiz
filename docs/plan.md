# Plan: certsafary MCP server (quiz service)

## Context
Учебный (некоммерческий) проект: remote MCP-сервер на TypeScript, к которому подключается обычный чат-агент. Сервер хранит в локальной SQLite-базе вопросы по темам с вариантами ответов, и даёт пользователю: случайный вопрос → проверка ответа → (по запросу) объяснение → (по запросу) shortcode для запоминания. Позже добавятся ресурсы (список вопросов, вопрос по id). Репозиторий пустой (только README.md), Node v24.14, npm 11.

Решения пользователя: `node:sqlite`, Streamable HTTP + Bearer-токен из env, npm, публикация как npm-пакет, свои вопросы пользователь даст позже (нужна схема + seed-скрипт, формат данных подстроим).

## Ключевые проектные решения
- **Не отдавать правильный ответ вместе с вопросом.** `get_random_question` и ресурсы возвращают только текст и варианты; правильность знает только `check_answer`. Иначе агент «подсмотрит» ответ.
- **Отдельные tools для каждого шага**: проверка, объяснение, shortcode — по запросу, как в требованиях.
- **Допущение:** «короткая заметка для быстрой ориентации» и «shortcode» — одно и то же поле `shortcode`. Если это разные сущности, добавим колонку `note`.
- **Допущение:** у вопроса ровно один правильный вариант (схема позволяет расширить до нескольких).
- **Stateless HTTP**: сессии не нужны, сервер не хранит состояние пользователя, `createServer()` вызывается на каждый запрос.
- Слой `services/` и `db/` не знает про MCP; tools — тонкие адаптеры.

## Структура
```
src/
  index.ts            # запуск HTTP-сервера (bin-точка входа)
  http.ts             # Express/Streamable HTTP, bearer-auth, /health
  server.ts           # createServer(): McpServer + регистрация tools/resources
  config.ts           # zod-разбор env: PORT, MCP_AUTH_TOKEN, DB_PATH
  db/
    connection.ts     # открытие DatabaseSync (node:sqlite), PRAGMA foreign_keys
    schema.sql        # topics, questions, options
    seed.ts           # data/questions.json -> SQLite (npm run db:seed)
    repository.ts     # prepared statements: random/byId/topics/list
  services/
    quiz.ts           # getRandomQuestion, checkAnswer, getExplanation, getShortcode
  tools/
    index.ts          # registerTools(server)
    get-random-question.ts   # input: { topic? }
    check-answer.ts          # input: { questionId, optionId } -> { correct, correctOptionId }
    get-explanation.ts       # input: { questionId }
    get-shortcode.ts         # input: { questionId }
    list-topics.ts
  resources/
    index.ts          # registerResources(server)
    questions.ts      # certsafary://questions (список), certsafary://questions/{id} (ResourceTemplate), без правильных ответов
  lib/errors.ts, logger.ts   # логи в stderr/pino
data/questions.json   # вопросы пользователя
tests/
  unit/               # quiz service на in-memory SQLite (':memory:')
  integration/        # Client <-> server через InMemoryTransport; HTTP через supertest/fetch
```

Схема БД: `topics(id, name)`, `questions(id, topic_id, text, shortcode, explanation)`, `options(id, question_id, label, is_correct, explanation)` — объяснение «почему правильно/неправильно» хранится на уровне варианта плюс общее на вопросе.

## Стек
Версии проверены через `npm view` 10.10.2026; перед установкой закрепить в `package.json` и свериться с API (мажоры недавно менялись).

**Рантайм и язык**
- Node.js 24 LTS (`engines: ">=24"`), ESM (`"type": "module"`, импорты с `.js`).
- TypeScript 7.x: `strict`, `noUncheckedIndexedAccess`, `module/moduleResolution: NodeNext`. `@types/node` версии 24.x (равна рантайму).

**MCP-слой**
- `@modelcontextprotocol/sdk` 1.32: `McpServer`, `registerTool`, `registerResource`, `ResourceTemplate`, `StreamableHTTPServerTransport`.
- Транспорт: Streamable HTTP, stateless (`sessionIdGenerator: undefined`).
- `zod` 4.x для схем входа/выхода (peer SDK: `^3.25 || ^4.0`); `outputSchema` + `structuredContent`; `annotations.readOnlyHint: true` на всех tools.

**HTTP-слой**
- Express 5 (как в примерах SDK).
- Bearer-auth: самописный middleware, сравнение через `crypto.timingSafeEqual`.
- Проверка `Origin`/`Host` (защита от DNS rebinding, требование спецификации MCP); `/health`.

**Данные**
- `node:sqlite` (`DatabaseSync`), prepared statements, спрятан за `db/repository.ts` (API может меняться; замена на `better-sqlite3` затрагивает один файл).
- Схема в `schema.sql` (`CREATE TABLE IF NOT EXISTS`), без ORM и миграций.
- Seed: `data/questions.json` + скрипт `db:seed` (через `tsx`), валидация через `zod` (ровно один правильный вариант, нет пустых полей).
- Сервер открывает БД с `readOnly: true`; `PRAGMA foreign_keys = ON`, `journal_mode = WAL`.

**Конфиг и логи**
- Конфиг: `zod` над `process.env`, падение на старте с понятной ошибкой; `.env` через `node --env-file`.
- Логи: `pino` 10.x (JSON, в stderr), `redact` для Authorization и токенов.

**Качество кода**
- Biome 2.x (линт + формат); `tsc --noEmit` отдельным скриптом. Git-хуки и CI откладываются до этапа CLAUDE.md/CI.

**Тестирование**
- Vitest 5.x (unit + integration).
- БД в тестах: `new DatabaseSync(':memory:')`.
- Протокол: `Client` из SDK + `InMemoryTransport.createLinkedPair()`.
- HTTP: `supertest` или `fetch` против сервера на порту `0` (401 без токена, `/health`, stateless).
- Обязательный инвариант: вопрос и ресурсы не содержат `is_correct`.

**Сборка и публикация**
- `tsc` → `dist/`; dev: `tsx watch src/index.ts`.
- npm-пакет: `bin`, `files: ["dist", "data", "src/db/schema.sql"]`, `prepublishOnly: build && test`; semver вручную (позже `changesets`).
- Отладка: `npx @modelcontextprotocol/inspector`.

**Отложено:** Docker, CI (GitHub Actions), OAuth 2.1, rate limiting, метрики/трейсинг.

## Шаги реализации
1. `npm init`, tsconfig (strict, NodeNext), biome, vitest, скрипты `dev`, `build`, `test`, `db:seed`, `inspect`.
2. `config.ts`, `db/*`, схема и seed (на 3–5 тестовых вопросах, пока нет данных пользователя).
3. `services/quiz.ts` + unit-тесты.
4. Tools (5 штук) с `.describe()` на полях и `annotations: { readOnlyHint: true }`; ошибки как `isError: true`.
5. HTTP-слой: Streamable HTTP в stateless-режиме, Bearer-middleware, проверка Origin, `/health`.
6. Ресурсы: список вопросов и шаблон по id.
7. Интеграционные тесты, README (запуск, подключение агента, переменные env).
8. Подготовка к npm: `bin`, `files` (dist + data + schema.sql), `engines: node>=24`.

## Верификация
- `npm test` — unit + integration (в т.ч. что `get_random_question` не содержит `is_correct`, а `check_answer` корректно различает верный/неверный ответ).
- `npm run dev`, затем `npx @modelcontextprotocol/inspector` по HTTP с Bearer-токеном: пройти цепочку random → check → explanation → shortcode, прочитать ресурсы.
- `curl` без токена на `/mcp` → 401.
- Подключить к реальному чат-агенту и пройти сценарий голосом/текстом.

## Вне объёма (следующие этапы)
CLAUDE.md с правилами кода/тестов, CI, deployment, OAuth, дополнительные ресурсы и prompts.

Claude-файлы (CLAUDE.md, rules, skills, агенты, hooks) и размещение best practices — см. [plan.claude-files.md](plan.claude-files.md).
