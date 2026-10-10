# certsafary

Учебный (некоммерческий) remote MCP-сервер на TypeScript. Хранит вопросы по темам в локальной SQLite-базе и даёт чат-агенту цепочку:

случайный вопрос → проверка ответа → объяснение (по запросу) → shortcode для запоминания (по запросу).

> Статус: проект на стадии планирования. Подробный план — [docs/plan.md](docs/plan.md). Команды и примеры ниже описывают целевое состояние и будут уточнены по мере реализации.

## Возможности

**Tools**

| Tool | Вход | Результат |
|---|---|---|
| `list_topics` | — | список тем |
| `get_random_question` | `{ topic? }` | текст вопроса и варианты ответа (без признака правильности) |
| `check_answer` | `{ questionId, optionId }` | `{ correct, correctOptionId }` |
| `get_explanation` | `{ questionId }` | объяснение |
| `get_shortcode` | `{ questionId }` | shortcode для запоминания |

**Resources**

- `certsafary://questions` — список вопросов;
- `certsafary://questions/{id}` — вопрос по id.

Ресурсы, как и `get_random_question`, не содержат правильного ответа: его знает только `check_answer`.

## Требования

- Node.js 24+
- npm 11+

## Быстрый старт

```bash
npm install
cp .env.example .env      # задайте MCP_AUTH_TOKEN
npm run db:seed           # загрузить вопросы из data/questions.json в SQLite
npm run dev               # сервер на http://localhost:3000/mcp
```

## Конфигурация

Переменные окружения (читаются из `.env` через `node --env-file`):

| Переменная | Назначение | По умолчанию |
|---|---|---|
| `PORT` | порт HTTP-сервера | `3000` |
| `MCP_AUTH_TOKEN` | Bearer-токен для доступа к `/mcp` | обязательна |
| `DB_PATH` | путь к файлу SQLite | `data/certsafary.db` |

При неверной конфигурации сервер падает на старте с понятной ошибкой.

## Подключение агента

Сервер работает по Streamable HTTP (stateless) и ожидает заголовок `Authorization: Bearer <MCP_AUTH_TOKEN>`.

- Endpoint: `http://localhost:3000/mcp`
- Проверка живости: `GET /health`
- Без токена `/mcp` отвечает `401`

Пример для клиента с `.mcp.json`:

```json
{
  "mcpServers": {
    "certsafary": {
      "type": "http",
      "url": "http://localhost:3000/mcp",
      "headers": { "Authorization": "Bearer ${MCP_AUTH_TOKEN}" }
    }
  }
}
```

Отладка через MCP Inspector:

```bash
npm run inspect
```

## Данные

Вопросы лежат в `data/questions.json` и загружаются командой `npm run db:seed`. Схема БД — `src/db/schema.sql`: темы, вопросы, варианты ответа.

Правила формата (проверяются при загрузке):

- у вопроса ровно один правильный вариант;
- пустые поля недопустимы.

## Команды

| Команда | Что делает |
|---|---|
| `npm run dev` | сервер с автоперезапуском |
| `npm run build` | сборка `tsc` → `dist/` |
| `npm test` | unit- и интеграционные тесты (Vitest) |
| `npm run lint` | проверка Biome |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:seed` | загрузка вопросов в SQLite |
| `npm run inspect` | MCP Inspector |

## Архитектура

```
src/
  index.ts      запуск HTTP-сервера
  http.ts       Streamable HTTP, Bearer-auth, /health
  server.ts     createServer(): регистрация tools и resources
  config.ts     разбор env (zod)
  db/           SQLite (node:sqlite), схема, seed, repository
  services/     бизнес-логика викторины
  tools/        MCP tools — тонкие адаптеры над services
  resources/    MCP resources
data/           вопросы (questions.json)
tests/          unit и integration
```

`db/` и `services/` не знают про MCP. Сервер не хранит состояние пользователя: `createServer()` вызывается на каждый запрос.

## Стек

Node.js 24, TypeScript, `@modelcontextprotocol/sdk`, Express 5, `node:sqlite`, zod, pino, Biome, Vitest.

## Безопасность

- Токен сравнивается через `crypto.timingSafeEqual`.
- Проверяются заголовки `Origin`/`Host` (защита от DNS rebinding).
- Authorization и токены не попадают в логи.
- Не коммитьте `.env`.
