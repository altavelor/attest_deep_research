# Spec: Agentic Skills и роли инструментов

## Контекст

Текущая система скилов (`SkillRegistry`, `SkillSelectionService`, каталог в `.ixplorer/skills/`) реализует
динамический выбор пользовательского скила на основе вопроса. Это создаёт ряд проблем:
- Модель сама выбирает скил через отдельный LLM-вызов (`SkillSelectionService`)
- Скилы — произвольные markdown-файлы, не контролируемые кодом
- Инструкции для модели о смысле инструментов разбросаны по описаниям инструментов и system prompt
- `search_notes` использует тот же retriever что и `search_index`, что нарушает разделение ролей

Данная спецификация описывает:
1. Чёткое разделение ролей инструментов на «evidence» и «editing»
2. Замену пользовательских скилов системой встроенных автоматических скилов
3. Переработку `search_notes` как pure keyword-поиска для навигации

---

## Часть 1: Роли инструментов

### Матрица ролей

| Инструмент | Роль | Результат цитируем? | Может влиять на рассуждения? |
|---|---|---|---|
| `search_index` | evidence | ✅ да | ✅ да |
| `search_web` | evidence | ✅ да | ✅ да |
| `fetch_web_page` | evidence | ✅ да | ✅ да |
| `search_notes` | editing navigation | ❌ нет | ❌ нет |
| `read_note` | editing access | ❌ нет | ❌ нет |
| `list_notes` | editing navigation | ❌ нет | ❌ нет |
| `get_active_note` | editing access | ❌ нет | ❌ нет | только для editing; как evidence — через explicitEvidence |
| `create_note` | editing mutation | — | — |
| `update_note` | editing mutation | — | — |
| `delete_note` | editing mutation | — | — |

**Evidence tools** возвращают `evidenceId` в результате; этот идентификатор является единственным
допустимым source ID для цитирования в финальном ответе.

**Editing tools** не возвращают `evidenceId`, не регистрируют чанки в `ResearchEvidenceRegistry`.
Их результаты видны модели, но не могут быть источником цитат.

### Изменения в описаниях инструментов

#### `search_notes` — переработка (breaking change)

**Текущее поведение**: использует `ResearchRetriever` с семантическим поиском; при отсутствии
результатов fallback на path-matching.

**Новое поведение**: только keyword/path-matching. Retriever из `search_notes` полностью убирается.

**Обоснование**: semantic search в `search_notes` создаёт риск что модель начнёт использовать
эти результаты как evidence. Keyword-only search явно указывает модели что это инструмент навигации,
а не поиска по содержанию.

**Новое описание инструмента**:
```
Find vault notes by keyword match in path or filename. Returns matching paths for editing navigation.
Results are NOT evidence and cannot be cited or used to reason about the question.
```

**Новая сигнатура ответа**:
```json
{
  "ok": true,
  "query": "...",
  "source": "path",
  "editingOnly": true,
  "results": [{ "path": "Notes/Foo.md", "snippet": "Notes/Foo.md" }]
}
```

Поле `editingOnly: true` — машиночитаемый маркер, закрепляющий роль.

#### `read_note` — добавить роль в description

```
Read the raw content of a vault note by path. For editing only — returned text is NOT citable evidence.
To search authoritative sources, use search_index or search_web instead.
```

#### `list_notes`

```
List vault notes by path prefix or keyword. For editing navigation only — results are not evidence.
```

#### `get_active_note`

```
Return the currently open Obsidian file path and its raw content. For editing only — not citable evidence.
```

---

## Часть 2: Система встроенных скилов

### Принципы

1. **Скилы встроены в код** (TypeScript string constants), не хранятся как vault-файлы.
2. **Автоматическая инъекция** — модель не выбирает скилы, они инжектируются на основе
   конфигурации запроса (`searchMode`, флаги доступности инструментов).
3. **None mode** — Core skill инжектируется в vault-варианте (без секции evidence/citations).
   Назначение None mode: прямые вопросы к LLM, манипуляция заметками, формирование summary.
4. **Максимум три скила одновременно**: Core + Index (опционально) + Web (опционально).

### Три встроенных скила

#### Скил 1: Core (всегда)

**Триггер**: любой режим, включая None.

**Два варианта содержания** в зависимости от `searchMode`:

---

**Вариант A — Core-Vault** (когда `searchMode === "none"`):
Назначение — объяснить принципы работы с vault: навигация, чтение, создание и редактирование заметок.
Секции evidence tools и citation format не включаются (инструментов поиска нет).

```
## Vault Assistant Principles

You are Ixplorer, a local-first Obsidian assistant.
Your vault tools let you navigate, read, and write notes directly.

### Finding notes (search_notes, list_notes)
- Use search_notes to find notes by keyword in path or filename.
- Use list_notes to browse by folder prefix.
- These tools return paths for navigation only — not content summaries.

### Reading notes (read_note, get_active_note)
- Use read_note to load the full content of a specific note before editing or summarising it.
- Use get_active_note to access the file currently open in Obsidian.

### Writing notes (create_note, update_note, delete_note)
- Call mutation tools only when the user explicitly requests a write action.
- Prefer append or prepend over replace to avoid data loss.
- Always verify the file exists (list_notes or read_note) before calling update_note.
- On {ok:false, reason:"already-exists"}: retry create_note with overwrite:true, or use update_note.
- On {ok:false, reason:"not-found"}: call create_note first, then update_note if needed.
- Never write to .ixplorer/ paths.

### Forming summaries
When asked to summarise or synthesise notes: read each relevant note with read_note,
then compose the summary from the actual note content. Do not invent facts not present in the notes.
```

---

**Вариант B — Core-Research** (когда `searchMode !== "none"`):
Назначение — принципы source-based ответа, разделение инструментов, формат цитирования, правила vault.

```
## Answer Principles

You are Ixplorer, a research assistant. Your goal is to answer the user's question
using authoritative sources retrieved by evidence tools.

### Evidence tools (search_index, search_web, fetch_web_page)
- Use these to find information relevant to the question.
- Each result contains an `evidenceId`. Use this ID — enclosed in square brackets like [evidenceId] —
  whenever you cite a source in your answer.
- Never invent an evidenceId. Only cite IDs that appear in tool results.
- Evidence from search_index and search_web has equal authority.

### Editing tools (search_notes, read_note, list_notes, get_active_note)
- Use these only when the user explicitly asks to read, create, update, or delete vault notes.
- Results from editing tools are NOT evidence. Do not cite them. Do not use them to reason
  about the answer to the user's question.

### Note mutation rules (create_note, update_note, delete_note)
- Call mutation tools only when the user explicitly requests a write action.
- Prefer append or prepend over replace to avoid data loss.
- Always verify the file exists (list_notes or read_note) before calling update_note.
- On {ok:false, reason:"already-exists"}: retry create_note with overwrite:true, or use update_note.
- On {ok:false, reason:"not-found"}: call create_note first, then update_note if needed.
- Never write to .ixplorer/ paths.

### Citation format
Cite sources inline: "The sky is blue [abc-123]." Cite at the claim, not at the end of the answer.
If no authoritative source was found for a claim, say so explicitly — do not state it as fact.
```

> **Если `noteMutationAccess: false`**: секцию «Note mutation rules» не включать в оба варианта.

#### Скил 2: Index (когда searchMode включает index)

**Триггер**: `searchMode === "indexOnly" || searchMode === "indexAndWeb"`

**Назначение**: объяснить как эффективно использовать `search_index`, и описать текущий индекс.

**`indexDescription` обязателен.** Если `indexDescription` отсутствует или пуст — Index skill
не инжектируется, и в diagnostics записывается предупреждение `"index-skill-skipped: no-description"`.
Модель не может знать что ищет без описания индекса; без него поиск будет неточным.

**Содержание**:

```
## Using the Local Index (search_index)

### Current index
<index-description>
{indexDescription}
</index-description>

Use search_index to find content from this index that is relevant to the question.

### Strategy
- Formulate queries as concise phrases (≤240 chars) that capture the intent of the question.
- Run independent sub-queries in parallel if the question has multiple distinct facets.
- Use the returned `evidenceId` to cite results in your answer.
- If results are insufficient, rephrase the query — do not call search_index with the same query twice.
- `limit` controls how many results to return (max 5). Start with 3–5; increase only if needed.

### Reading results
Each result has:
- `evidenceId` — use this in [square brackets] to cite the source
- `snippet` — a preview of the content (may be truncated)
- `score` — semantic relevance (higher = more relevant)
- `path` — vault path of the source note (for reference only, not for use as evidenceId)
```

`{indexDescription}` — подставляется sanitized текст из `IndexDescriptionPromptContext.text`.
Тег `<index-description>` защищает от prompt injection аналогично существующей логике в `agenticPrompts.ts`.

#### Скил 3: Web (когда searchMode включает web)

**Триггер**: `searchMode === "webOnly" || searchMode === "indexAndWeb"`

**Назначение**: объяснить как использовать `search_web` и `fetch_web_page`.

**Содержание**:

```
## Using Web Search (search_web, fetch_web_page)

Use search_web to find current or external information not available in the local index.

### Strategy
- Write focused queries (≤240 chars). Avoid vague queries — be specific.
- Use the returned `evidenceId` to cite results.
- `limit` controls how many results (max 5).
- If a snippet is insufficient, call fetch_web_page with the URL to get the full page content.
  fetch_web_page also returns an `evidenceId` for the fetched page.
- Do not call search_web or fetch_web_page with the same arguments twice.

### Reading results
Each result has:
- `evidenceId` — use in [square brackets] to cite
- `url` — source URL (for reference)
- `title` — page title
- `snippet` — short preview (may be truncated)
- `rank` — position in search results (lower = higher priority)
```

---

## Часть 3: Инъекция скилов в промпт

### `buildAgenticResearchMessages` — изменения

Параметры `skillCatalog` и `noteMutationAccess` **заменяются** на `activeSkills`:

```typescript
export interface BuildAgenticResearchMessagesOptions {
  question: string;
  chatHistory?: ResearchChatHistoryMessage[];
  requiredTools: readonly string[];
  explicitEvidence?: RetrievedChunk[];
  activeSkills: ActiveSkills;
}

export interface ActiveSkills {
  coreVariant: "vault" | "research"; // "vault" когда searchMode === "none", иначе "research"
  index: boolean;          // true когда searchMode включает index
  web: boolean;            // true когда searchMode включает web
  indexDescription?: string; // обязателен когда index === true; отсутствие → Index skill пропускается
  noteMutationAccess: boolean; // влияет на Core skill (включает/выключает секцию mutation rules)
}
```

Порядок секций в system prompt:

1. Mandatory tools policy (1–2 предложения, неизменно)
2. Core skill (если `activeSkills.core`)
3. Index skill (если `activeSkills.index`)
4. Web skill (если `activeSkills.web`)
5. Explicit evidence (если есть)

Секция с untrusted evidence disclaimer (`"Only the application decides..."`) остаётся как
первая строка после mandatory tools.

### Сборка в `ResearchService.answerAgentically`

```typescript
const activeSkills: ActiveSkills = {
  coreVariant: options.searchMode === "none" ? "vault" : "research",
  index: options.searchMode === "indexOnly" || options.searchMode === "indexAndWeb",
  web: options.searchMode === "webOnly" || options.searchMode === "indexAndWeb",
  // indexDescription обязателен когда index === true
  // если отсутствует — buildAgenticResearchMessages пропустит Index skill и запишет warning
  indexDescription: options.indexDescription?.text,
  noteMutationAccess: this.noteTools?.mutationEnabled() === true,
};
```

**None mode в agentic loop**: None mode использует `deterministic` стратегию, но если модель
вызывается напрямую (например, для vault manipulation без поиска), Core-Vault skill инжектируется
через тот же `buildAgenticResearchMessages`. Если None mode полностью обходит agent runner — Core-Vault
skill инжектируется в промпт `AnswerSynthesisService` как system-section.

---

## Часть 4: Ликвидация старой системы скилов

### Что удаляется

| Компонент | Действие |
|---|---|
| `SkillRegistry` + файлы `.ixplorer/skills/` | Удалить |
| `SkillSelectionService` | Удалить |
| `buildSkillCatalogPrompt` | Удалить |
| `resolveExplicitSkill` | Удалить |
| `skillCatalog` параметр в `buildAgenticResearchMessages` | Удалить |
| `skillAccess` в `ResearchToolAvailability` | Удалить |
| `NoteToolHandlerAdapter.skillOnly` режим | Удалить |
| `isInternalSkillPath` фильтрация в `search_notes` / `search_index` | Удалить |
| `skill-contract-violation` fallback reason | Удалить |
| `validSkillCalls` функция | Удалить |
| Skill-related поля в `ContextDiagnostics` | Удалить |
| `SKILL_ROOT` константа в `NoteTools.ts` | Удалить |
| `readSkill` метод в `NoteToolService` | Удалить |

### Что остаётся

| Компонент | Статус |
|---|---|
| `ResearchToolRegistry` | Без изменений |
| `NoteToolService` (без skillRegistry) | Упрощается |
| `AgenticResearchRunner` | Без изменений |
| `ResearchEvidenceRegistry` | Без изменений |
| `IndexResearchTool` | Без изменений |
| `WebSearchResearchTool` | Без изменений |
| `WebFetchResearchTool` | Без изменений |

---

## Часть 5: Изменения в `search_notes` implementation

### Текущий код (`NoteToolService.searchWithRetriever`)

Удалить метод `searchWithRetriever` полностью.

### Новый `searchNotes`

```typescript
private async searchNotes(args: Record<string, unknown>): Promise<NoteToolExecution> {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) {
    return jsonResult(false, { ok: false, reason: "missing-query" });
  }
  const limit = boundLimit(readPositiveNumber(args.limit), this.searchResultLimit, 20);
  const results = await this.searchPaths(query, limit);
  return jsonResult(true, {
    ok: true,
    query,
    source: "path",
    editingOnly: true,
    results,
  });
}
```

**`searchPaths` остаётся без изменений** — case-insensitive substring match по путям.

---

## Часть 6: Изменения в `read_note`

Удалить ветку `readSkill`:

```typescript
private async readNote(args: Record<string, unknown>): Promise<NoteToolExecution> {
  const path = normalizePathArg(args.path);
  if (!path) {
    return jsonResult(false, { ok: false, reason: "missing-path" });
  }
  // Удалить: if (path.startsWith(`${SKILL_ROOT}/`)) { return this.readSkill(path); }
  return this.readSupportedPath(path, readPositiveNumber(args.maxChars) ?? this.readNoteMaxChars);
}
```

**`ResearchEvidenceRegistry` в `NoteToolHandlerAdapter`**: editing tools (`read_note`, `get_active_note`)
больше не регистрируют chunks в evidence registry. Удалить вызов `this.evidence.registerNoteEvidence`.

---

## Часть 7: Active note как explicitEvidence

### Проблема

`get_active_note` ранее входил в mandatory tools (`ResearchExecutionPolicy.mandatoryTools`), что
создавало противоречие с его ролью editing tool. Модель получала конфликтующие инструкции:
Core-Research skill — «editing tools не evidence», mandatory policy — «`get_active_note` обязателен».

### Решение: active note через explicitEvidence, вне tool loop

Когда `includeActiveFile === true`:
1. **До запуска agent runner** `answerAgentically` читает содержимое активного файла
   через `NoteToolService` (или напрямую через `ContextFileProvider`).
2. Содержимое упаковывается в `RetrievedChunk[]` и передаётся как `explicitEvidence`
   в `buildAgenticResearchMessages`.
3. В промпте активный файл появляется в секции `<explicit-evidence id="...">` —
   как цитируемый источник, наравне с другими attached evidence.
4. `get_active_note` **исключается из mandatory tools** в `ResearchExecutionPolicy`.
   В tool loop он остаётся доступным только как editing tool (для чтения/редактирования заметки
   по запросу пользователя).

### Изменения в коде

**`ResearchExecutionPolicy.mandatoryTools`**: убрать ветку `includeActiveFile`.

```typescript
function mandatoryTools(searchMode: ResearchSearchMode): readonly string[] {
  const tools: string[] = [];
  if (searchMode === "indexOnly" || searchMode === "indexAndWeb") tools.push("search_index");
  if (searchMode === "webOnly" || searchMode === "indexAndWeb") tools.push("search_web");
  // get_active_note больше не mandatory — передаётся через explicitEvidence
  return Object.freeze(tools);
}
```

**`ResearchService.answerAgentically`**: добавить чтение активного файла перед сборкой messages.

```typescript
// Новый блок перед buildAgenticResearchMessages:
let activeNoteEvidence: RetrievedChunk[] = [];
if (options.request.includeActiveFile && options.request.activeFilePath && this.noteTools) {
  const activeResult = await this.noteTools.execute({
    id: "active-note-prefetch",
    name: "get_active_note",
    arguments: {},
  });
  if (activeResult.ok) {
    activeNoteEvidence = parseActiveNoteChunks(activeResult.result);
    // registerNoteEvidence не вызывается — chunks передаются как explicitEvidence напрямую
  }
}

const messages = buildAgenticResearchMessages({
  ...
  explicitEvidence: [...(assembled?.explicitEvidence ?? []), ...activeNoteEvidence],
});
```

**`get_active_note` tool description**: обновить, чтобы отражала роль editing-only.

```
Return the currently open Obsidian file path and its raw content.
For editing only — not citable evidence.
The active note content is already provided as attached context at the start of this conversation.
```

### Поведение в Core-Vault skill (None mode)

В None mode `includeActiveFile` также может быть true. Там нет agent runner, поэтому
active note передаётся через тот же `explicitEvidence` механизм в `AnswerSynthesisService`.
Core-Vault skill объясняет модели использовать `get_active_note` tool только если пользователь
явно просит прочитать текущую заметку заново (например, после редактирования).

---

## Часть 8: `sanitize()` — исправление

Текущая реализация заменяет `<>` на Unicode-lookalikes `‹›`, что ломает код и математику в content.

**Новая реализация**: не изменять контент; вместо этого оборачивать в тег с явным `data-untrusted` атрибутом,
либо использовать XML entities:

```typescript
function sanitize(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
```

LLM-модели устойчиво читают HTML-entities в контексте. Это сохраняет семантику контента.

---

## Файлы, затронутые изменениями

```
src/research/agenticPrompts.ts              — buildAgenticResearchMessages: новый ActiveSkills API
src/research/ResearchService.ts             — убрать SkillRegistry/SkillSelectionService;
                                               active note prefetch → explicitEvidence;
                                               сборка activeSkills
src/research/ResearchExecutionPolicy.ts     — убрать includeActiveFile из mandatoryTools
src/research/tools/NoteTools.ts             — search_notes: убрать retriever;
                                               read_note: убрать readSkill;
                                               get_active_note: обновить description
src/research/tools/ResearchToolRegistry.ts  — удалить skillAccess, skillOnly режим
src/research/tools/createResearchToolRegistry.ts — удалить skillAccess
src/skills/SkillRegistry.ts                — удалить весь файл
src/skills/SkillSelectionService.ts        — удалить весь файл
src/shared/types.ts                        — удалить skill-поля из ContextDiagnostics
src/shared/pathFilters.ts                  — удалить isInternalSkillPath
tests/unit/agentic-prompts.test.ts         — обновить тесты под новый API
tests/unit/note-tools.test.ts              — удалить skill-related тесты
```

---

## Границы (Boundaries)

**Всегда:**
- `search_index`, `search_web`, `fetch_web_page` регистрируют результаты в `ResearchEvidenceRegistry` → доступны для цитирования
- `search_notes`, `read_note`, `list_notes`, `get_active_note` НЕ регистрируют в `ResearchEvidenceRegistry`
- Active note при `includeActiveFile === true` читается до запуска runner и передаётся как `explicitEvidence`
- Core skill инжектируется всегда (vault-вариант для None, research-вариант для остальных)
- Index skill инжектируется только при `searchMode` включающем index, и только если `indexDescription` присутствует
- Web skill инжектируется только при `searchMode` включающем web

**Никогда:**
- `search_notes` не вызывает `ResearchRetriever`
- Editing tools не возвращают `evidenceId`
- `get_active_note` не входит в mandatory tools policy
- Скилы не выбираются моделью и не загружаются через `read_note`
- Vault-файлы в `.ixplorer/skills/` не используются (могут быть оставлены без migration)

---

## Открытые вопросы

1. **Удалить `.ixplorer/skills/` из vault при upgrade?** ✅ Да — папку удалять при upgrade.
   Добавить миграцию в plugin `onload`: если папка существует, переместить в trash через
   `VaultWriter.trashFile` или Obsidian vault API напрямую.

2. **`indexDescription` sanitize** ✅ Да — HTML entities (`&lt;` / `&gt;` / `&amp;`).
   Применяется к тексту перед вставкой в `<index-description>` тег.

3. **`fetch_web_page` в Core skill** ✅ Только в Web skill. ✅ Решено.

4. **Mutation rules при `noteMutationAccess: false`** ✅ Секцию не включать. ✅ Решено.

5. **None mode и agentic runner** ✅ Core-Vault skill инжектируется в `AnswerSynthesisService`
   напрямую как system-section — отдельная точка инъекции, не через `buildAgenticResearchMessages`.

6. **`get_active_note` как explicitEvidence** ✅ Решено: зафиксировано в Части 7.
