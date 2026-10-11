# Plan: certquiz MCP server (quiz service)

## Context
Учебный (некоммерческий) проект: remote MCP-сервер на TypeScript, к которому подключается обычный чат-агент. Сервер хранит в локальной SQLite-базе вопросы по темам с вариантами ответов, и даёт пользователю: случайный вопрос → проверка ответа → (по запросу) объяснение → (по запросу) short note для запоминания. Позже добавятся ресурсы (список вопросов, вопрос по id). Репозиторий пустой (только README.md), Node v24.14, npm 11.

Решения пользователя: `node:sqlite`, Streamable HTTP + Bearer-токен из env, npm, публикация как npm-пакет, свои вопросы пользователь даст позже (нужна схема + seed-скрипт, формат данных подстроим).

## Ключевые проектные решения
- **Не отдавать правильный ответ вместе с вопросом.** `get_question` и ресурсы возвращают только текст и варианты; правильность знает только `check_answer`. Иначе агент «подсмотрит» ответ.
- **Отдельные tools для каждого шага**: проверка, объяснение, short note — по запросу, как в требованиях.
- **Решение:** «short note» — короткий текст о том, как смотреть на вопрос и понимать его, — отдельная таблица `short_notes(id, title UNIQUE, text)`. Одну заметку могут использовать несколько вопросов, и у вопроса может быть несколько заметок: связь «вопрос ↔ заметки» многие-ко-многим, таблица `question_short_notes(question_id, short_note_id)`, см. README, раздел «Данные». Заметка может намекать на ответ; это допустимо: цель приложения — обучение, а не контроль знаний. Tool `get_short_notes` отдаёт список заметок вопроса по запросу, а ресурс `quiz://questions/{id}/short-notes` доступен в любой момент. Инвариант это не меняет: правильный вариант знает только `check_answer`, заметки и ресурсы его не раскрывают намеренно (`is_correct` не отдаётся).
- **Допущение:** у вопроса ровно один правильный вариант. [Устарело: схема теперь не допускает несколько правильных вариантов (см. строку схемы ниже); поддержка нескольких потребует смены схемы и импорта.]
- **Stateless HTTP**: сессии не нужны, сервер не хранит состояние пользователя, `createServer()` вызывается на каждый запрос.
- Слой `services/` и `db/` не знает про MCP; tools — тонкие адаптеры.

## Структура
```
src/
  index.ts            # запуск HTTP-сервера (bin-точка входа) (готово, F5.1)
  http.ts             # Express/Streamable HTTP, /health (готово, F5.1; bearer-auth F5.2 и Origin/Host F5.3 пока нет)
  server.ts           # createServer(service): McpServer + регистрация tools/resources (готово, F4.1)
  config.ts           # zod-разбор env: HOST, PORT, MCP_AUTH_TOKEN, DB_PATH, LOG_LEVEL; loadDbPath() для db:seed
  db/
    connection.ts     # открытие DatabaseSync (node:sqlite), applySchema, PRAGMA foreign_keys/WAL
    schema.sql        # topics, short_notes, questions, options, question_short_notes
    raw-data.ts       # [устарело: парсер перенесён в .claude/skills/raw-data-to-json/parser.ts, см. пометку ниже]
    import.ts         # additive, идемпотентный импорт в одной транзакции (dry run откатывает)
    report.ts         # текст отчёта импорта: счётчики и Qn, без правильных вариантов
    run-seed.ts       # seedDatabase(): чтение файлов, импорт, очистка созданного файла при ошибке
    seed.ts           # CLI npm run db:seed (--dry-run, --json-dir; was --raw-dir, design changed, see the note below)
    repository.ts     # создан: getTopic, listTopics, getQuestion (с вариантами), getRandomQuestionId(topicId?), getCorrectOptionId (единственное серверное чтение is_correct, только для checkAnswer), getExplanation, getShortNotes (prepared statements)
  services/
    quiz.ts           # createQuizService: getTopic, listTopics, getQuestion, getRandomQuestion(topicId?), checkAnswer, getExplanation, listShortNotes (ресурс, [] без заметок), getShortNotes (tool, NotFoundError без заметок); NotFoundError из lib/errors.ts, для вопроса без правильного варианта AppError
  tools/
    index.ts          # registerTools(server, service) (готово)
    shared.ts         # toolJson, toolError, toolInputError: NotFoundError → isError с текстом; прочие ошибки → «Internal error», без деталей в ответе (готово)
    get-question.ts          # input: { questionId?, topicId? } (вместе нельзя); output: { id, text, options: [{id, label}] } (готово, F4.2)
    check-answer.ts          # input: { questionId, optionId } -> { correct, correctOptionId } (готово, F4.3)
    get-explanation.ts       # input: { questionId } (готово, F4.4)
    get-short-notes.ts       # input: { questionId }; отдаёт список заметок (готово, F4.5)
    list-topics.ts           # (готово, F4.6)
  resources/
    index.ts          # registerResources(server, service)
    shared.ts         # parseId (id строго положительное целое, иначе -32602), readJson (NotFoundError → -32002, прочие ошибки → -32603, логируются без деталей)
    topics.ts         # quiz://topics/{id} (ResourceTemplate)
    questions.ts      # quiz://questions (список, пока не реализован, см. plan.features F4.7), quiz://questions/{id} (ResourceTemplate), без правильных ответов
    short-notes.ts    # quiz://questions/{id}/short-notes (ResourceTemplate)
  lib/errors.ts, logger.ts   # логи в stderr/pino
raw-data/            # исходные файлы вопросов и заметок (в .gitignore)
tests/
  unit/               # quiz service на in-memory SQLite (':memory:')
  integration/        # Client <-> server через InMemoryTransport; HTTP через supertest/fetch
```

> **Устарело (пометка, сам план не переписан):** `seed.ts` принимает `--json-dir` (по умолчанию `raw-data/json`), а не `--raw-dir`. `db:seed` читает только JSON из `raw-data/json/`; JSON пишет скилл `raw-data-to-json` (`convert.mts`) из markdown через парсер `.claude/skills/raw-data-to-json/parser.ts` (раньше `src/db/raw-data.ts`; перенесён, т.к. `_shortNotes*.md` читает только скилл). `db:seed` парсер не вызывает и markdown не читает; тесты парсера в `tests/skills/raw-data-to-json/`, серверные тесты строят данные из JSON-фикстур. Добавлен `seed-json.ts` (чтение и zod-валидация JSON). Актуальная структура: README, раздел «Architecture».

Схема БД: `topics(id, name)`, `short_notes(id, title, text)`, `questions(id, topic_id, text, explanation)` (`topic_id` с `ON DELETE RESTRICT`: тему с вопросами удалить нельзя; индекс по `topic_id` даёт `UNIQUE (topic_id, text)`), `options(id, question_id, position, label, is_correct)` (`position` с `CHECK (position >= 1)`; ровно один правильный вариант у вопроса с вариантами гарантирует БД: частичный уникальный индекс `one_correct_per_question` и триггеры `options_correct_first`, `options_correct_update`, `options_no_move`, `options_correct_delete`), `question_short_notes(question_id, short_note_id)` (составной первичный ключ, `WITHOUT ROWID`, оба внешних ключа с `ON DELETE CASCADE`, индекс по `short_note_id`). Объяснение «почему правильно/неправильно» хранится одно на вопрос (`questions.explanation`), отдельного объяснения на варианте нет.

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
- `node:sqlite` (`DatabaseSync`), prepared statements, спрятан за `db/repository.ts` (файл создан, пока с минимальным набором; запись и импорт пока идут через `node:sqlite` напрямую в `src/db/`).
- Схема в `schema.sql` (`CREATE TABLE IF NOT EXISTS`), без ORM и миграций. Гарантия одного правильного варианта: индекс `one_correct_per_question` и восемь триггеров `options_*` / `questions_*`, в том числе запрещающие REPLACE-пути. Правильный вариант вставляется первым, а `id` вариантов `import.ts` назначает явно (по порядку источника), иначе правильный вариант всегда имел бы наименьший `id`, и клиент угадывал бы ответ без `check_answer`. Триггеры при повторном `db:seed` обновляются, а таблицы и индексы существующей базы не меняются: при изменении таблиц, ограничений или индексов базу нужно пересоздать (удалить файл и выполнить `db:seed`).
- Seed: файлы `raw-data/` + скрипт `db:seed` (через `tsx`), парсер (сейчас `.claude/skills/raw-data-to-json/parser.ts`, раньше `src/db/raw-data.ts`) и импорт `src/db/import.ts` (ровно один правильный вариант, нет пустых полей, идемпотентно, только добавляет). Отчёт импорта — `src/db/report.ts`. [Устарело: `db:seed` читает JSON из `raw-data/json/`, а не markdown; см. пометку после структуры.]
- Сервер открывает БД с `readOnly: true`; `PRAGMA foreign_keys = ON`, `journal_mode = WAL`.
- Инструменты мейнтейнера для БД (команды, не для квиз-сессий; только `SELECT`): `/get-question [id]` (без id случайный вопрос), `/get-question-explanation <id>` (единственный скилл, читающий `is_correct`), `/get-question-notes <id>`, `/get-stats [topic-id]`. `/get-stats` без аргумента выводит сводку по категориям (ID, название, вопросов, уникальных шортноутов; «Итого» считает уникальные заметки по всей выборке); с `topics.id` добавляет строку категории и таблицу вопросов с числом шортноутов у каждого. Только счётчики: ни вариантов, ни `is_correct`, ни текстов заметок. Подробнее: `docs/plan.features.md`, F1.10.

**Конфиг и логи**
- Конфиг: `zod` над `process.env`, падение на старте с понятной ошибкой; `.env` через `node --env-file`.
- Логи: `pino` 10.x (JSON, в stderr), `redact` для Authorization и токенов.

**Качество кода**
- Biome 2.x (линт + формат); `tsc --noEmit` отдельным скриптом. Git-хуки и CI откладываются до этапа CLAUDE.md/CI. [Устарело: git-хуки внедрены (см. README, «Git hooks»); CI частично внедрён, статус и план: [plan.github-actions.md](plan.github-actions.md).]

**Тестирование**
- Vitest 5.x (unit + integration).
- БД в тестах: `new DatabaseSync(':memory:')`.
- Протокол: `Client` из SDK + `InMemoryTransport.createLinkedPair()`.
- HTTP: `supertest` или `fetch` против сервера на порту `0` (401 без токена, `/health`, stateless).
- Обязательный инвариант: вопрос и ресурсы не содержат `is_correct`.

**Сборка и публикация**
- `tsc` → `dist/`; dev: `tsx watch src/index.ts`.
- npm-пакет: `bin`, `files: ["dist", "data", "src/db/schema.sql"]`, `prepublishOnly: build && test`; semver вручную (позже `changesets`). Решение пользователя: база данных входит в npm-пакет (`data/certquiz.db` лежит в `data/`, `files` содержит `data`, `.gitignore` на состав пакета не влияет). Базу пересоздают командой `db:seed` из `raw-data/json/` (скилл `/import-raw-data`), перед публикацией она должна быть актуальной. Содержимое `raw-data/` в пакет не входит.
- Отладка: `npx @modelcontextprotocol/inspector`.

**Отложено:** Docker, OAuth 2.1, rate limiting, метрики/трейсинг. CI (GitHub Actions) частично внедрён, оставшиеся задачи: [plan.github-actions.md](plan.github-actions.md).

## Шаги реализации
1. `npm init`, tsconfig (strict, NodeNext), biome, vitest, скрипты `dev`, `build`, `test`, `db:seed`, `inspect`.
2. `config.ts`, `db/*`, схема и seed (на 3–5 тестовых вопросах, пока нет данных пользователя). Seed читает `raw-data/` (файлы пользователя), `data/questions.json` и тестовые вопросы больше не используются; см. README, раздел «Данные». [Устарело: seed читает `raw-data/json/`, JSON готовит `raw-data-to-json`.]
3. `services/quiz.ts` + unit-тесты.
4. Tools (5 штук) с `.describe()` на полях и `annotations: { readOnlyHint: true }`; ошибки как `isError: true`.
5. HTTP-слой: Streamable HTTP в stateless-режиме, Bearer-middleware, проверка Origin, `/health`.
6. Ресурсы: список вопросов и шаблон по id.
7. Интеграционные тесты, README (запуск, подключение агента, переменные env).
8. Подготовка к npm: `bin`, `files` (dist + data + schema.sql), `engines: node>=24`.

## Верификация
- `npm test` — unit + integration (в т.ч. что `get_question` не содержит `is_correct`, а `check_answer` корректно различает верный/неверный ответ).
- `npm run dev`, затем `npx @modelcontextprotocol/inspector` по HTTP с Bearer-токеном: пройти цепочку random → check → explanation → short note, прочитать ресурсы.
- `curl` без токена на `/mcp` → 401.
- Подключить к реальному чат-агенту и пройти сценарий голосом/текстом.

## Вне объёма (следующие этапы)
CLAUDE.md с правилами кода/тестов, deployment, OAuth, дополнительные ресурсы и prompts. ~~CI~~ — сделано: GitHub Actions внедрены, оставшиеся задачи в [plan.github-actions.md](plan.github-actions.md).

Claude-файлы (CLAUDE.md, rules, skills, агенты, hooks) и размещение best practices — см. [plan.claude-files.md](plan.claude-files.md).
