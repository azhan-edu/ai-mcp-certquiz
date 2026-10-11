# Структура файлов Claude для certquiz

## Область применения
Структура ниже относится к **MCP-серверу certquiz** — репозиторию, где мы пишем сам сервер. Она помогает Claude Code разрабатывать сервер: форматировать код, гонять тесты, добавлять вопросы и tools, не допускать утечки правильного ответа.

`.mcp.json` — единственное исключение: он подключает уже запущенный certquiz к Claude Code, чтобы проверить цепочку random → check → explanation → short note. Это тест сервера, а не клиентское приложение.

**Клиентское приложение/агент** (то, что будет пользоваться сервером) — отдельный набор файлов, см. раздел «Открытый вопрос».

## Структура
```
CLAUDE.md                      # коммитится; главный контекст проекта (до ~100 строк)
CLAUDE.local.md                # в .gitignore; личные заметки/пути
.mcp.json                      # коммитится; подключение certquiz к Claude Code (пока не создан, после HTTP-слоя)
.claude/
  settings.json                # коммитится; permissions (hooks — планируются)
  settings.local.json          # в .gitignore; личные разрешения
  rules/
    typescript.md              # strict, NodeNext, импорты с .js, noUncheckedIndexedAccess
    mcp-tools.md               # .describe() на полях, readOnlyHint, isError, tools — тонкие адаптеры
    testing.md                 # vitest, :memory: SQLite, InMemoryTransport, инвариант is_correct
    http-security.md           # bearer + timingSafeEqual, Origin/Host, redact логов, не коммитить .env
    database.md                # node:sqlite, schema.sql, импорт raw-data/, инвариант is_correct
  skills/
    import-raw-data/SKILL.md   # создать/обновить БД: raw-data-to-json, затем db:seed (сначала --dry-run)
    raw-data-to-json/SKILL.md  # конвертация raw-data/*.md в JSON (convert.mts + parser.ts; единственный код, читающий _shortNotes*.md), пишет только в raw-data/
    get-question/SKILL.md      # показать текст вопроса и варианты по id или случайного вопроса без аргумента (только для сопровождающего, не для квиза)
    get-question-explanation/SKILL.md # показать верный ответ и объяснение по id (единственный скилл, читающий is_correct; только для сопровождающего, не для квиза)
    get-question-notes/SKILL.md # показать шорт-ноуты вопроса по id (только для сопровождающего, не для квиза)
    get-stats/SKILL.md         # статистика БД: вопросы и шорт-ноуты по категориям; детали по вопросам только при указанном topic-id (только для сопровождающего, не для квиза)
    new-mcp-tool/SKILL.md      # шаблон нового tool: файл в src/tools, регистрация, тест (планируется)
  commands/                    # планируется
    verify.md                  # /verify: biome + tsc --noEmit + vitest
    inspect.md                 # /inspect: dev-сервер + MCP Inspector
  agents/                      # подробнее — в разделе «Агенты»
    mcp-developer.md           # tools и ресурсы, SDK, zod-схемы
    backend-developer.md       # HTTP-слой, config, services
    db-engineer.md             # schema.sql, db/* (seed-json, import, seed), repository.ts (планируется)
    test-engineer.md           # unit и integration на Vitest
    code-reviewer.md           # ревью diff (read-only)
    quiz-invariant-reviewer.md # ревью: не утекает ли is_correct (read-only)
    security-auditor.md        # bearer, Origin/Host, секреты, зависимости (read-only)
    db-reviewer.md             # ревью SQL и схемы (read-only)
    build-verifier.md          # lint + typecheck + test + build, только ошибки
    npm-release-checker.md     # готовность к публикации в npm
    docs-writer.md             # README, plan.md, CLAUDE.md в актуальном виде
  hooks/                       # планируется
    format-on-edit.sh          # biome format после Edit/Write по *.ts
    block-secrets.sh           # PreToolUse: запрет правок .env, токенов
```

## Содержимое ключевых файлов
- **CLAUDE.md**: назначение проекта; стек (Node 24, TS, MCP SDK, node:sqlite, Express 5, vitest, biome); команды не дублируются, они в README; слои (`services/` и `db/` не знают про MCP); ключевые решения из `docs/plan.md` (не отдавать правильный ответ, stateless HTTP); ссылка `@docs/plan.md`; запреты (не коммитить `.env`, не менять `schema.sql` без обновления seed).
- **.claude/settings.json**: `permissions.allow` — `npm run *`, `npx biome *`, `npx tsc --noEmit`, `npx vitest *`, `git status/diff/log`; `deny` — `Read(.env*)`, `Bash(rm -rf *)`; `hooks` — PostToolUse (Edit|Write → format-on-edit), PreToolUse (block-secrets).
- **.mcp.json**: certquiz-сервер (url `http://localhost:PORT/mcp`, заголовок Bearer из `${MCP_AUTH_TOKEN}`); опционально `@modelcontextprotocol/inspector`.
- **.gitignore** дополнить: `CLAUDE.local.md`, `.claude/settings.local.json`, `.env`.

## Где хранить best practices и примеры
| Что | Куда | Почему |
|---|---|---|
| Короткие правила и запреты для любой правки (3–5 строк на тему), инвариант `is_correct` | `CLAUDE.md` | Загружается всегда, поэтому короткий |
| Best practices по слоям, привязанные к путям: TypeScript, MCP tools, SQL, HTTP/безопасность, тесты | `.claude/rules/*.md` с `paths:` | Подгружаются только при работе с подходящими файлами; 1–2 маленьких примера «правильно/неправильно» |
| Шаблоны и примеры процедур («добавить tool», «добавить вопрос») | `.claude/skills/<name>/` (`SKILL.md` + файлы-шаблоны) | Загружаются по требованию, пример рядом с пошаговой инструкцией |
| Обоснования, паттерны, ссылки на внешние ресурсы (для людей) | `docs/conventions.md` | В контекст Claude не попадает, пока не сослались через `@` |
| Эталонные примеры | сам код: образцовый tool и образцовый тест | Не устаревают; rules ссылаются: «делай как в `src/tools/get-question.ts`» |

## Агенты
Агентов делим на пишущих (могут редактировать код), проверяющих (без Write и Edit) и вспомогательных. Определения (frontmatter и промпт) написаны на английском. Пишущих запускаем на крупные изолированные задачи, мелкие правки Claude делает сам.

| Агент | Задача | Инструменты | Модель |
|---|---|---|---|
| `mcp-developer` | Tools и ресурсы: `src/tools/`, `src/resources/`, `src/server.ts` | Read, Write, Edit, Bash, Grep, Glob | sonnet |
| `backend-developer` | HTTP-слой, config, сервисы | Read, Write, Edit, Bash, Grep, Glob | sonnet |
| `db-engineer` | `schema.sql`, `src/db/*` (парсер raw-data, импорт, `seed.ts`), `repository.ts` (планируется) | Read, Write, Edit, Bash, Grep, Glob | sonnet |
| `test-engineer` | Unit и integration на Vitest, краткий итог вместо сырого вывода | Read, Write, Edit, Bash, Grep, Glob | sonnet |
| `code-reviewer` | Ревью diff: корректность, типы, слои, стиль | Read, Grep, Glob, Bash (git, чтение) | opus |
| `quiz-invariant-reviewer` | Утечка `is_correct` в вопросы, ресурсы, логи, ошибки | Read, Grep, Glob | sonnet |
| `security-auditor` | Bearer, Origin/Host, секреты, логи, зависимости | Read, Grep, Glob, Bash (чтение, `npm audit`) | opus |
| `db-reviewer` | Ревью SQL, схемы и согласованности с seed | Read, Grep, Glob | sonnet |
| `build-verifier` | lint, typecheck, test, build; возвращает только ошибки | Bash, Read, Grep | haiku |
| `npm-release-checker` | `bin`, `files`, `engines`, `npm pack --dry-run`; не публикует | Read, Bash, Grep | sonnet |
| `docs-writer` | README, `plan.md`, CLAUDE.md в соответствии с кодом | Read, Write, Edit, Grep, Glob | haiku |

Оговорки:
- `mcp-developer` и `backend-developer` пересекаются; в проекте два слоя и мало файлов, поэтому их можно объединить в одного `developer`.
- Запрет записи у проверяющих с Bash держится на тексте промпта; жёсткая блокировка делается хуком `PreToolUse`.
- Не выделяем в агентов: добавление вопросов и шаблон нового tool (это skills), общее ревью и security-review (уже есть `/code-review`, `/security-review`), planner и explorer (встроенные Plan и Explore).

## Порядок создания
1. `CLAUDE.md` (≈25 строк) + `.gitignore` — сразу, без кода.
2. `.claude/settings.json` (permissions) и `rules/`: `typescript.md`, `mcp-tools.md`, `database.md`, `http-security.md`, `testing.md`.
3. Агенты по этапам:
   - старт: `mcp-developer`, `db-engineer`, `test-engineer`, `code-reviewer`, `quiz-invariant-reviewer`;
   - с HTTP-слоем: `backend-developer`, `security-auditor`;
   - с первыми скриптами `package.json`: `build-verifier`, `db-reviewer`;
   - перед публикацией: `npm-release-checker`, `docs-writer`.
4. После первого tool и первого теста: skill `new-mcp-tool`, `docs/conventions.md`, ссылки на эталонные файлы в rules.
5. После `npm init` и скриптов: hooks (format-on-edit, block-secrets), commands `/verify` и `/inspect`; после запуска HTTP — `.mcp.json`.

## Верификация
- `/memory` показывает подхваченные CLAUDE.md и rules.
- `/permissions`, `/hooks` показывают settings.json; правка `.ts` запускает форматирование.
- `/mcp` показывает certquiz подключённым при запущенном `npm run dev`.
- `git status`: local-файлы не попадают в коммит.

## Открытый вопрос: клиентское приложение
Для приложения/агента, использующего сервер, нужен отдельный набор:
- системный промпт со сценарием: вопрос → ответ → объяснение и short note только по запросу;
- конфиг подключения к серверу: URL и Bearer-токен;
- свой CLAUDE.md.

Решить: делать ли его в отдельном репозитории (рекомендуется) и на чём писать клиент (Claude API или Agent SDK).
