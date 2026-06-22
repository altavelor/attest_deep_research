# Spec: Note Mutation Tools for Agent Use

## Objective

Добавить инструменты `create_note`, `update_note` и `delete_note` в `NoteToolService`, чтобы подключённые агенты могли создавать, редактировать и удалять заметки в хранилище Obsidian. Архитектура должна предусматривать возможность запрашивать подтверждение пользователя перед выполнением мутирующих операций — но на данном этапе подтверждение не требуется и механизм остаётся заглушкой.

**Целевая аудитория:** агенты (LLM tool-calling), которые уже используют read/search/list инструменты через `ResearchToolRegistry`.

---

## Новые инструменты

### `create_note`

Создаёт новую заметку по указанному пути.

```json
{
  "name": "create_note",
  "parameters": {
    "path": "string — vault-relative path, must end with .md",
    "content": "string — markdown content",
    "overwrite": "boolean (optional) — if true, overwrites existing note; default false"
  }
}
```

**Поведение:**
- Если файл существует и `overwrite = false` — возвращает ошибку `already-exists`.
- Если путь содержит несуществующие папки — создаёт их рекурсивно (аналогично `AnswerNoteWriter.ensureFolder`).
- Путь нормализуется через `normalizeVaultPath`.
- Запись в пути `.ixplorer/` запрещена (системная папка плагина).

**Ответ (success):**
```json
{ "ok": true, "path": "Notes/New Note.md", "created": true }
```

---

### `update_note`

Перезаписывает или дополняет содержимое существующей заметки.

```json
{
  "name": "update_note",
  "parameters": {
    "path": "string — vault-relative path",
    "content": "string — new full content",
    "mode": "\"replace\" | \"append\" | \"prepend\" — default \"replace\""
  }
}
```

**Поведение:**
- Если файл не найден — возвращает ошибку `not-found`.
- `replace` — полная замена содержимого (`vault.modify`).
- `append` — добавляет контент в конец (`vault.append`).
- `prepend` — читает текущее содержимое и записывает `content + "\n\n" + existing`.
- Запись в пути `.ixplorer/` запрещена.

**Ответ (success):**
```json
{ "ok": true, "path": "Notes/Existing.md", "mode": "append" }
```

---

### `delete_note`

Перемещает заметку в корзину Obsidian (trash), не удаляет файл напрямую.

```json
{
  "name": "delete_note",
  "parameters": {
    "path": "string — vault-relative path"
  }
}
```

**Поведение:**
- Если файл не найден — возвращает ошибку `not-found`.
- Использует `vault.trash(file, true)` (системная корзина).
- Удаление из `.ixplorer/` запрещено.

**Ответ (success):**
```json
{ "ok": true, "path": "Notes/Old.md", "trashed": true }
```

---

## Архитектура

### Интерфейс `VaultWriter`

Новый порт для мутирующих операций. Изолирует доступ к vault от `NoteToolService`, чтобы сервис оставался тестируемым без Obsidian API.

```typescript
// src/research/tools/NoteTools.ts (или отдельный файл)
export interface VaultWriter {
  exists(path: string): Promise<boolean>;
  createFile(path: string, content: string): Promise<void>;
  modifyFile(path: string, content: string): Promise<void>;
  appendFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string>;
  trashFile(path: string): Promise<void>;
  ensureFolder(path: string): Promise<void>;
}
```

Реализация для Obsidian: `ObsidianVaultWriter` в `src/research/tools/ObsidianVaultWriter.ts`.

### Механизм подтверждения (заглушка)

Вводится интерфейс `NoteActionConfirmation` для будущего подтверждения:

```typescript
export type NoteActionType = "create" | "update" | "delete";

export interface NoteActionRequest {
  action: NoteActionType;
  path: string;
  content?: string;
}

export interface NoteActionConfirmation {
  confirm(request: NoteActionRequest): Promise<boolean>;
}

// Заглушка (используется по умолчанию):
export const AUTO_CONFIRM: NoteActionConfirmation = {
  confirm: async () => true,
};
```

`NoteToolService` принимает опциональный `confirmation?: NoteActionConfirmation` в своих опциях. Если не передан — используется `AUTO_CONFIRM`.

### Изменения в `NoteToolServiceOptions`

```typescript
export interface NoteToolServiceOptions {
  // ... существующие поля ...
  writer?: VaultWriter;                     // если не передан — мутирующие инструменты недоступны
  confirmation?: NoteActionConfirmation;    // если не передан — AUTO_CONFIRM
  noteMutationAccess?: boolean;             // флаг доступности мутирующих инструментов
}
```

### Доступность инструментов

Мутирующие инструменты регистрируются только если `noteMutationAccess === true` и `writer` передан.

В `ResearchToolAvailability` добавляется поле:
```typescript
noteMutationAccess: boolean;
```

В `adaptNoteToolHandlers` добавляется фильтрация по этому флагу.

В настройках профиля (`ChatModelProfile`) добавляется `noteMutationAccess: boolean` (по умолчанию `false`).

---

## Валидация пути

Вся логика валидации выносится в утилиту `validateMutablePath(path: string): { ok: true } | { ok: false; reason: string }`:

- Путь не пустой.
- Заканчивается на `.md`.
- Не начинается с `.ixplorer/`.
- Прошёл `normalizeVaultPath`.

---

## Структура файлов

```
src/research/tools/
  NoteTools.ts               — добавить VaultWriter, NoteActionConfirmation, AUTO_CONFIRM,
                               новые методы createNote/updateNote/deleteNote,
                               новые определения инструментов
  ObsidianVaultWriter.ts     — новый файл: реализация VaultWriter через Obsidian vault API
  ResearchToolRegistry.ts    — добавить noteMutationAccess в NoteToolAvailability и фильтрацию
  createResearchToolRegistry.ts — пробрасывать noteMutationAccess
src/settings/settings.ts    — добавить noteMutationAccess в ChatModelProfile и настройки по умолчанию
src/main.ts                 — создавать ObsidianVaultWriter и передавать в NoteToolService
tests/unit/
  note-tools.test.ts         — тесты мутирующих инструментов
  note-tools-mutation.test.ts — или расширить существующий файл
```

---

## Тестовая стратегия

Тесты — unit, через `MemoryVaultWriter` (in-memory реализация `VaultWriter`).

**Покрываемые сценарии:**

| Инструмент | Сценарий | Ожидание |
|---|---|---|
| `create_note` | Новый файл | `ok: true`, файл создан |
| `create_note` | Файл существует, `overwrite: false` | `ok: false`, reason `already-exists` |
| `create_note` | Файл существует, `overwrite: true` | `ok: true`, файл перезаписан |
| `create_note` | Путь в `.ixplorer/` | `ok: false`, reason `forbidden-path` |
| `create_note` | Не `.md` расширение | `ok: false`, reason `invalid-path` |
| `update_note` | `mode: replace` | Содержимое заменено |
| `update_note` | `mode: append` | Содержимое добавлено в конец |
| `update_note` | `mode: prepend` | Содержимое добавлено в начало |
| `update_note` | Файл не найден | `ok: false`, reason `not-found` |
| `delete_note` | Файл существует | `ok: true`, `trashed: true` |
| `delete_note` | Файл не найден | `ok: false`, reason `not-found` |
| Все | `confirmation` возвращает `false` | `ok: false`, reason `user-cancelled` |
| Все | `writer` не передан | Инструменты не регистрируются |

---

## Границы (Boundaries)

**Всегда:**
- Нормализовать пути через `normalizeVaultPath` перед любой операцией.
- Использовать `vault.trash` вместо прямого удаления файлов.
- Создавать папки рекурсивно при создании файла.

**Спрашивать (в будущем, через `NoteActionConfirmation`):**
- Перезапись существующего файла (`overwrite: true`).
- Удаление файла.
- Редактирование файла в режиме `replace`.

**Никогда:**
- Не писать напрямую в `.ixplorer/` (системная папка плагина, скиллы, настройки).
- Не удалять файлы минуя корзину Obsidian.
- Не регистрировавзть мутирующие инструменты, если `writer` не предоставлен.
- Не добавлять `noteMutationAccess: true` в профиль по умолчанию.

---

## Решённые вопросы

1. **Не-`.md` файлы** — не поддерживаются. Ограничение на `.md` остаётся в `validateMutablePath`.
2. **Переименование** — `rename_note` не входит в текущий объём.
3. **Конфликты при `prepend`** — принимаем как известное ограничение. Obsidian Vault API не предоставляет атомарных операций чтения-записи. В описании инструмента `update_note` указывается, что режим `prepend` не является атомарным: если файл был изменён между чтением и записью, изменения будут перезаписаны. Агент должен использовать `prepend` только там, где вероятность конкурентного редактирования мала.
