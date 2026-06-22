# SPEC: Reasoning Chain Display

## Проблема

Текущий блок "Research progress" выводит reasoning-сегменты (текст из `<thinking>`) друг за другом, без каких-либо разрывов между раундами инструментов. Пользователь видит стену текста и не может понять:

- Какие инструменты были вызваны и с каким запросом
- Когда модель начинала "думать заново" после получения результата
- Насколько глубоким был поиск

**Желаемый вид (conceptual):**
```
▾ Research · 2 rounds · 4.2 s

  Думаю о запросе...             ← reasoning-сегмент
  → Поиск в индексе: "zettelkasten inbox"   ← tool call
  → Поиск в индексе: "fleeting notes"       ← tool call
  Нашёл несколько заметок. Проверю одну из них...
  → Читаю: Notes/Inbox process.md           ← tool call
  Теперь достаточно контекста для ответа.
```

---

## Архитектурный обзор

### Текущий поток данных

```
AgenticResearchRunner
  └─ collectRound()
       ├─ onDelta(type: "reasoningSummary") → ResearchStreamEvent "reasoning"
       ├─ onDelta(type: "text")             → ResearchStreamEvent "checkpoint-delta"
       └─ [tool calls executed — ничего не эмитируется]
                ↓
ResearchQuestionController
  ├─ "reasoning"         → nextAssistantReasoning()  → reasoning.segments
  ├─ "checkpoint-delta"  → nextAssistantCheckpoint() → checkpoints
  └─ [tool calls: нет событий]
                ↓
renderReasoningSegments()
  ├─ segments  → маркдаун блоки
  └─ checkpoints → "Provisional checkpoint N"
```

### Целевой поток данных

```
AgenticResearchRunner
  └─ collectRound()
       ├─ onDelta("reasoningSummary") → "reasoning"
       ├─ onDelta("text")             → "checkpoint-delta"
       └─ after tool execution       → "tool-call-start" + "tool-call-end"
                ↓
ResearchQuestionController
  ├─ "reasoning"        → appendToChain({ kind: "reasoning" })
  ├─ "checkpoint-delta" → appendToChain({ kind: "checkpoint" })
  ├─ "tool-call-start"  → appendToChain({ kind: "tool-call", status: "pending" })
  └─ "tool-call-end"    → updateChainItem(id, { status: "complete"|"failed" })
                ↓
renderReasoningChain()
  ├─ reasoning  → маркдаун блок
  ├─ checkpoint → промежуточный ответ (коллапсируется при финале)
  └─ tool-call  → pill с иконкой, названием инструмента, лейблом и статусом
```

---

## Детальная спецификация

### 1. Новые stream-события

Добавить в `ResearchStreamEvent` (файл `src/research/types.ts`):

```typescript
| { type: "tool-call-start"; id: string; name: string; label: string; round: number }
| { type: "tool-call-end";   id: string; ok: boolean; resolvedLabel?: string }
```

- `tool-call-start` эмитируется **перед** выполнением инструмента
- `tool-call-end` эмитируется **после** получения результата
- `label` в `tool-call-start` — предварительный ярлык из аргументов, строится функцией `toolCallChainLabel`
- `resolvedLabel` в `tool-call-end` — уточнённый ярлык из результата инструмента (только для `fetch_web_page`; остальные `undefined`)

### 2. Функция `toolCallChainLabel`

Новый файл или часть `src/research/tools/toolCallLabel.ts`:

```typescript
export function toolCallChainLabel(name: string, args: Record<string, unknown>): string
```

| Tool name         | Аргументы      | Лейбл                                  |
|-------------------|----------------|----------------------------------------|
| `search_index`    | `query`        | `args.query` (до 60 символов)          |
| `search_notes`    | `query`        | `args.query` (до 60 символов)          |
| `search_web`      | `query`        | `args.query` (до 60 символов)          |
| `fetch_web_page`  | `resultId`     | `"Fetching page"` (заменяется на hostname из результата через `resolvedLabel`) |
| `read_note`       | `path`         | `basename(args.path)`                  |
| `get_active_note` | —              | `"Active note"`                        |
| `list_notes`      | `prefix?`      | `args.prefix ? args.prefix : "All notes"` |
| `create_note`     | `path`         | `basename(args.path)`                  |
| `update_note`     | `path`         | `basename(args.path)`                  |
| `delete_note`     | `path`         | `basename(args.path)`                  |
| (default)         | —              | `name` (snake_case как есть)           |

`basename(path)` = последний сегмент пути без расширения `.md` (если есть).

Для `search_index` / `search_notes` / `search_web`: если `args.query` пустой или не строка — лейбл `name`. Строка обрезается до 60 символов с добавлением `…` если длиннее.

Для `fetch_web_page`: `toolCallChainLabel` возвращает `"Fetching page"` как placeholder. После завершения вызова `AgenticResearchRunner` парсит результат и, если `ok: true`, извлекает hostname из поля `url` или `finalUrl` (например, `"example.com"`). Этот hostname передаётся как `resolvedLabel` в `tool-call-end`, и UI обновляет лейбл chain-item.

### 3. Изменения в `AgenticResearchRunner`

В `AgenticResearchRunnerOptions` добавить опциональные коллбэки:

```typescript
onToolCall?(id: string, name: string, label: string, round: number): void;
onToolResult?(id: string, ok: boolean, resolvedLabel?: string): void;
```

В методе `run()`, в цикле по `response.toolCalls`, обернуть вызов `this.options.tools.execute(call)`:

```typescript
const label = toolCallChainLabel(call.name, call.arguments);
this.options.onToolCall?.(call.id, call.name, label, round);
const raw = await this.options.tools.execute(call);
execution = serializeExecution(raw);
const resolvedLabel = resolveLabelFromResult(call.name, execution.result);
this.options.onToolResult?.(call.id, raw.ok, resolvedLabel);
```

`resolveLabelFromResult(name, resultJson)`:
- Только для `fetch_web_page`: парсит JSON, берёт `value.finalUrl ?? value.url`, возвращает `new URL(url).hostname`. При любой ошибке парсинга — возвращает `undefined`.
- Для всех остальных инструментов: `undefined`.

`resolveResultSummary(name, resultJson)` — новая вспомогательная функция, возвращает краткий итог для отображения в pill:

| Tool name                   | Логика                                                | Пример             |
|-----------------------------|-------------------------------------------------------|--------------------|
| `search_index`, `search_web`, `search_notes` | `value.results.length` → `"N results"` (0 → `"no results"`) | `"5 results"` |
| `fetch_web_page`            | `value.content.length` → `"~N kb"` (rounded)         | `"~2.1 kb"`        |
| `read_note`, `get_active_note` | длина результирующего текста → `"~N kb"`           | `"~1.4 kb"`        |
| `create_note`, `update_note`, `delete_note` | `"done"` при `ok: true`              | `"done"`           |
| (default / parse error)     | `undefined` — ничего не показывать                    | —                  |

`resolvedLabel` и `resultSummary` передаются вместе в `tool-call-end`:

```typescript
const resolvedLabel = resolveLabelFromResult(call.name, execution.result);
const resultSummary = resolveResultSummary(call.name, execution.result);
this.options.onToolResult?.(call.id, raw.ok, resolvedLabel, resultSummary);
```

Сигнатуры коллбэков и событий обновляются аналогично (`resolvedLabel?: string, resultSummary?: string`).

> Для дублированных (cache-hit) вызовов: тоже эмитировать оба события — пользователь видит, что поиск был произведён.

### 4. Изменения в `ToolLoopRunner`

В `ToolLoopRunnerOptions` добавить в `ToolLoopEvent`:

```typescript
| { type: "tool-call-start"; id: string; name: string; label: string; round: number }
| { type: "tool-call-end";   id: string; ok: boolean }
```

В `runToolLoop()`, перед/после вызова `options.executeTool(toolCall)`:

```typescript
const label = toolCallChainLabel(toolCall.name, toolCall.arguments);
options.onEvent?.({ type: "tool-call-start", id: toolCall.id, name: toolCall.name, label, round });
const execution = await options.executeTool(toolCall);
const resolvedLabel = resolveLabelFromResult(toolCall.name, execution.result);
options.onEvent?.({ type: "tool-call-end", id: toolCall.id, ok: execution.ok, resolvedLabel });
```

### 5. Изменения в `ResearchService.answerAgentically`

В коллбэке `onDelta` дополнить `onToolCall` / `onToolResult`:

```typescript
onToolCall: (id, name, label, round) =>
  options.onEvent?.({ type: "tool-call-start", id, name, label, round }),
onToolResult: (id, ok, resolvedLabel) =>
  options.onEvent?.({ type: "tool-call-end", id, ok, resolvedLabel }),
```

### 6. Новая модель данных в `rendering.ts`

#### `ChainItem`

```typescript
export type ChainItem =
  | { kind: "reasoning";  segmentId: string; content: string }
  | { kind: "checkpoint"; id: string; round: number; content: string; status: "streaming" | "complete" | "superseded" }
  | { kind: "tool-call";  id: string; name: string; label: string; status: "pending" | "complete" | "failed"; resultSummary?: string }
```

`resultSummary` — краткий итог вызова, отображается в pill рядом с лейблом. Примеры: `"5 results"`, `"~2.1 kb"`, `"done"`. Заполняется из результата инструмента функцией `resolveResultSummary` (см. §3).

#### Обновление `AssistantResearchProgress`

```typescript
export interface AssistantResearchProgress {
  phase: "idle" | "streaming" | "complete" | "interrupted";
  disclosure: "auto" | "user-open" | "user-closed";
  view: "expanded" | "compact";                // ← НОВОЕ: режим просмотра, default "expanded"
  reasoning: AssistantReasoningState;          // ← оставить для backward compat (legacy messages)
  checkpoints: ResearchProgressCheckpoint[];   // ← оставить для backward compat
  chain: ChainItem[];                          // ← НОВОЕ: упорядоченный список всех элементов
}
```

`chain` заполняется в новых сообщениях. Если `chain.length > 0` — рендерить через chain-логику; иначе — fallback на старые `segments` + `checkpoints`.

#### Новые функции в `rendering.ts`

```typescript
// Добавить reasoning-сегмент в chain
export function nextAssistantReasoningChain(
  messages: ChatDisplayMessage[],
  segmentId: string,
  delta: string,
): ChatDisplayMessage[]

// Добавить/обновить checkpoint в chain
export function nextAssistantCheckpointChain(
  messages: ChatDisplayMessage[],
  checkpointId: string,
  round: number,
  delta: string,
): ChatDisplayMessage[]

// Пометить checkpoint завершённым или superseded
export function completeAssistantCheckpointChain(
  messages: ChatDisplayMessage[],
  checkpointId: string,
  superseded: boolean,  // true при checkpoint-promote (финал — промоушен checkpoint'а в ответ)
): ChatDisplayMessage[]

// Добавить tool-call в chain (status: "pending")
export function nextAssistantToolCallStart(
  messages: ChatDisplayMessage[],
  id: string,
  name: string,
  label: string,
): ChatDisplayMessage[]

// Обновить статус tool-call + опционально уточнить лейбл
export function nextAssistantToolCallEnd(
  messages: ChatDisplayMessage[],
  id: string,
  ok: boolean,
  resolvedLabel?: string,
): ChatDisplayMessage[]
```

Все функции работают с `message.researchProgress.chain`, создавая его при необходимости через `researchProgressFromMessage`.

### 7. Изменения в `ResearchQuestionController.applyResearchEvent`

```typescript
if (event.type === "reasoning") {
  // Если chain поддерживается — направить в chain
  this.options.setMessages(nextAssistantReasoningChain(..., event.segmentId, event.content));
  // fallback: оставить nextAssistantReasoning для совместимости не нужен
  // (chain и segments независимы, chain строится заново в новых сессиях)
  this.options.renderActiveMessage();
  return;
}

if (event.type === "checkpoint-delta") {
  this.options.setMessages(nextAssistantCheckpointChain(..., event.checkpointId, event.round, event.content));
  this.options.renderActiveMessage();
  return;
}

if (event.type === "tool-call-start") {
  this.options.setMessages(nextAssistantToolCallStart(..., event.id, event.name, event.label));
  this.options.renderActiveMessage();
  return;
}

if (event.type === "tool-call-end") {
  this.options.setMessages(nextAssistantToolCallEnd(..., event.id, event.ok, event.resolvedLabel));
  this.options.renderActiveMessage();
  return;
}
```

Существующие обработчики `checkpoint-complete` и `checkpoint-promote` должны также обновлять статус соответствующего `ChainItem` типа `checkpoint`.

### 8. Рендеринг в `ChatTranscript.ts`

Переработать `renderReasoningSegments` → `renderReasoningContent`:

```
function renderReasoningContent(containerEl, message, options):
  if chain exists and non-empty:
    renderChain(containerEl, chain, progress, options)
  else:
    renderLegacySegments(containerEl, segments, checkpoints, options)
```

#### `<summary>` строка

Вместо текстовой строки типа `"Research progress · 2 rounds · 4.2 s"` — строка с иконками категорий и счётчиками:

```
▾  [🔍 3]  [📄 1]  [🌐 2]  ·  4.2 s        [⊟ compact toggle]
```

Структура:
- Для каждой категории инструментов, которые встречались в цепочке: иконка + количество вызовов
- Порядок: index search, note search, web search, web fetch, read note, write note
- Категории с нулём вызовов не показываются
- Если фаза `streaming`: вместо времени — `Thinking…`
- Справа в `<summary>` — кнопка переключения `view` (иконка `align-justify` для compact / `align-left` для expanded); клик не раскрывает/закрывает `<details>`

Реализация summary: `buildChainSummary(chain): { counts: Map<category, number>, durationMs?: number }`.

#### Spine line

`.ixplorer-chat__chain` имеет CSS `position: relative`. Pseudo-element `::before` рисует вертикальную линию по левому краю контейнера (отступ ~10px). Каждый `ChainItem` имеет `padding-left` чтобы не перекрываться с линией. Линия обрывается у последнего элемента (через ограничение `height` pseudo-element или `::after` у последнего item).

#### `renderChain`

Для каждого элемента цепочки:

**`kind: "reasoning"`** (в режиме `view: "expanded"`)  
— рендерить маркдаун-блок с CSS-классом `ixplorer-chat__chain-reasoning`  
— если `content.length > 400`: показывать первые 400 символов + кнопку "Show more" (`ixplorer-chat__chain-reasoning-toggle`); при клике разворачивается полный текст  
— в режиме `view: "compact"`: `display: none`

**`kind: "checkpoint"`** (в режиме `view: "expanded"`)  
— рендерить как промежуточный ответ (маркдаун), CSS-класс `ixplorer-chat__chain-checkpoint`  
— статус `streaming` / `complete`: видим в цепочке как есть  
— статус `superseded`: `display: none`  
— в режиме `view: "compact"`: `display: none`

**`kind: "tool-call"`**  
— рендерить как одну строку: `[иконка] [лейбл] [resultSummary?] [статус-индикатор]`  
— CSS-класс `ixplorer-chat__chain-tool-call`  
— при `status: "failed"`: дополнительный класс `ixplorer-chat__chain-tool-call--failed` (красноватый фон, иконка `alert-triangle`); статус-индикатор показывает причину в `title`-атрибуте  
— `resultSummary` рендерится как `<span class="ixplorer-chat__chain-tool-result">· N results</span>` — muted цвет, отделён точкой  
— видим в обоих режимах (`expanded` и `compact`)

**Иконки по категориям инструментов:**

| Категория           | Инструменты                                 | Иконка (Lucide)  |
|---------------------|---------------------------------------------|------------------|
| Index search        | `search_index`                              | `search`         |
| Note search         | `search_notes`, `list_notes`                | `file-search`    |
| Web search          | `search_web`                                | `globe`          |
| Web fetch           | `fetch_web_page`                            | `link`           |
| Read note           | `read_note`, `get_active_note`              | `file-text`      |
| Write note          | `create_note`, `update_note`, `delete_note` | `file-edit`      |

**Статус-индикатор для tool-call:**  
- `pending` → spinner (CSS animation)
- `complete` → скрыт
- `failed` → `alert-triangle` иконка

---

## Backward Compatibility

Сохранённые чаты используют `reasoning.segments` и `checkpoints` (без `chain`). Условие в `renderReasoningContent`:
```
chain.length > 0 → chain-рендер
иначе → legacy-рендер (существующий код)
```

Функции `nextAssistantReasoning`, `nextAssistantCheckpoint`, etc. не удалять — они используются для legacy.

---

## Файлы, затронутые изменениями

| Файл | Изменение |
|------|-----------|
| `src/research/types.ts` | `+tool-call-start`, `+tool-call-end` в `ResearchStreamEvent` |
| `src/research/tools/toolCallLabel.ts` | **Новый файл**: `toolCallChainLabel()`, `resolveLabelFromResult()`, `resolveResultSummary()` |
| `src/research/AgenticResearchRunner.ts` | `+onToolCall`, `+onToolResult` коллбэки, эмит до/после execute |
| `src/research/tools/ToolLoopRunner.ts` | `+tool-call-start`, `+tool-call-end` в `ToolLoopEvent`, эмит |
| `src/research/ResearchService.ts` | Передача коллбэков в `AgenticResearchRunner` |
| `src/ui/rendering.ts` | `+ChainItem`, `+chain` в `AssistantResearchProgress`, новые `next*Chain` функции |
| `src/ui/ResearchQuestionController.ts` | Обработка `tool-call-start`, `tool-call-end`; направление событий в chain |
| `src/ui/ChatTranscript.ts` | `renderReasoningContent`: chain vs legacy, `renderChain`, `buildChainSummary`, compact toggle |
| `styles.css` (или аналог) | CSS для `.ixplorer-chat__chain-*` классов |

---

## CSS-структура (reference)

```
.ixplorer-chat__chain                        — контейнер цепочки
  position: relative
  padding-left: 20px
  ::before                                   — spine line: вертикальная линия слева

  .ixplorer-chat__chain-reasoning            — блок reasoning текста
    font-size: 0.88em
    color: var(--text-muted)
    font-style: italic
    margin-bottom: 4px

  .ixplorer-chat__chain-reasoning-toggle     — кнопка "Show more" / "Show less"
    display: block
    font-size: 0.8em
    color: var(--text-accent)
    cursor: pointer

  .ixplorer-chat__chain-checkpoint           — промежуточный ответ (маркдаун)

  .ixplorer-chat__chain-tool-call            — одна строка вызова инструмента
    display: flex; align-items: center; gap: 6px
    padding: 2px 6px
    border-radius: 4px
    background: var(--background-secondary)

  .ixplorer-chat__chain-tool-call--failed    — модификатор при status: "failed"
    background: var(--background-modifier-error)
    color: var(--text-error)

    .ixplorer-chat__chain-tool-icon          — Lucide иконка категории
    .ixplorer-chat__chain-tool-label         — конкретный запрос / имя файла
    .ixplorer-chat__chain-tool-result        — "· 5 results" / "· ~2.1 kb"
      color: var(--text-muted)
      font-size: 0.85em
    .ixplorer-chat__chain-tool-status        — spinner (pending) | alert-triangle (failed)

.ixplorer-chat__reasoning-summary            — строка <summary>
  display: flex; align-items: center; gap: 8px

  .ixplorer-chat__chain-summary-icons        — иконки с счётчиками
    display: flex; gap: 6px

  .ixplorer-chat__chain-summary-icon-group   — [иконка + число] для одной категории
    display: flex; align-items: center; gap: 2px; font-size: 0.85em

  .ixplorer-chat__chain-view-toggle          — кнопка compact/expanded (крайний правый)
    margin-left: auto
```

---

---

## Fallback-синтез при провале agentic-цикла

### Проблема

Когда agentic-цикл не смог получить финальный ответ (limit exceeded, budget exceeded, etc.), сейчас система запускает весь deterministic pipeline заново — дорого и медленно. При этом `snapshot.evidence` уже содержит все данные, собранные за прошедшие раунды. Пользователь получает ответ без индикации того, что что-то пошло не так.

### Требование

Если agentic-цикл завершился провалом (`result.ok === false`) **и** в `snapshot.evidence` есть хотя бы один chunk — не запускать deterministic pipeline, а синтезировать ответ из уже собранных данных через `AnswerSynthesisService.synthesize()`. Ответ помечать как `fallback` — пользователь должен видеть явное предупреждение.

### Новый `AgenticFallbackReason`: `"loop-detected"`

Добавить в `AgenticResearchRunner.ts`:

```typescript
export type AgenticFallbackReason =
  | ...
  | "loop-detected";   // ← НОВОЕ
```

**Критерий обнаружения петли** — в конце обработки tool-calls раунда:

```typescript
const roundDuplicates = response.toolCalls.filter(call => {
  const key = normalizedCallKey(call);
  return cache.has(key) && !mutationTool(call.name);
}).length;

if (roundDuplicates === response.toolCalls.length && response.toolCalls.length > 0) {
  return failure("loop-detected");
}
```

Условие: **все** вызовы в раунде — cache-hit'ы (не были реально выполнены). Это означает, что модель запросила те же данные, которые уже имеет — новой информации не поступит и прогресс невозможен. Mutation-инструменты из проверки исключены.

Проверка выполняется после обработки всех calls раунда, но **до** фазового перехода (bootstrap/repair/research).

### Триггеры и исключения

| `AgenticFallbackReason`              | Действие                                   |
|--------------------------------------|--------------------------------------------|
| `cancelled`                          | Прервать, ничего не показывать             |
| `provider-error`                     | Показать ошибку (без fallback-синтеза)     |
| `loop-detected`                      | Fallback-синтез если есть evidence         |
| `model-round-limit-exceeded`         | Fallback-синтез если есть evidence         |
| `tool-call-limit-exceeded`           | Fallback-синтез если есть evidence         |
| `tool-result-budget-exceeded`        | Fallback-синтез если есть evidence         |
| `context-limit-exceeded`             | Fallback-синтез если есть evidence         |
| `multiple-mandatory-tools-unresolved`| Fallback-синтез если есть evidence; иначе deterministic |
| `mandatory-repair-failed`            | Fallback-синтез если есть evidence; иначе deterministic |

Если `evidence.length === 0` — переходить на deterministic pipeline как сейчас (поведение не меняется).

### Изменения в data model

#### `ResearchAnswer` (`src/shared/types.ts`)

```typescript
export interface ResearchAnswer {
  question: string;
  answer: string;
  citations: Citation[];
  evidence?: RetrievedChunk[];
  contextDiagnostics?: ContextDiagnostics;
  followUpQuestions: string[];
  createdAt: string;
  isFallback?: true;                 // ← НОВОЕ: признак fallback-ответа
  fallbackReason?: AgenticFallbackReason;  // ← НОВОЕ: причина провала
}
```

#### `ChatDisplayMessage` (`src/ui/rendering.ts`)

```typescript
export interface ChatDisplayMessage {
  ...
  isFallback?: true;
  fallbackReason?: string;
}
```

Заполняется в `attachAnswerDetailsToLastAssistantMessage` — пробрасывает поля из `ResearchAnswer`.

### Изменения в `ResearchService.answer()`

В блоке обработки провала agentic-цикла:

```typescript
if (!agentic.result.ok) {
  if (agentic.result.reason === "cancelled") return;
  if (agentic.result.reason === "provider-error") {
    // прежнее поведение: ошибка
    throw ...;
  }
  const partialEvidence = agentic.answer.evidence ?? [];
  if (partialEvidence.length > 0) {
    // Новая ветка: синтез из уже собранных данных
    yield { type: "status", message: "Synthesizing from partial results…" };
    yield* this.answerSynthesis.synthesize({
      question,
      evidence: partialEvidence,
      citations: agentic.answer.citations ?? [],
      chatHistory: request.chatHistory,
      evidenceLimit: this.evidenceLimit,
      contextDiagnostics: request.includeContextDiagnostics
        ? agentic.diagnostics
        : undefined,
      signal: request.signal,
      fallback: { reason: agentic.result.reason },  // ← триггер fallback-режима
    });
    return;
  }
  // Если evidence нет — прежний путь
  failedAgenticAttempt = agentic.result;
  executionStrategy = "deterministic-fallback";
}
```

### Изменения в `AnswerSynthesisService`

#### `AnswerSynthesisInput` — новое поле

```typescript
fallback?: { reason: string };
```

#### Поведение при `fallback`

1. В system prompt добавляется дополнительный блок **перед** основными инструкциями:

```
IMPORTANT: The research process could not complete ({reason}).
You are synthesizing a best-effort answer from PARTIAL results.
Begin your response with a clear notice that the answer may be incomplete.
Do not pretend to have complete information.
```

2. В `answer: ResearchService`-ответ добавляются `isFallback: true` и `fallbackReason: reason`.

3. `AnswerSynthesisService.synthesize()` проставляет эти поля в возвращаемый `ResearchAnswer`.

### UI: отображение fallback-ответа

В `ChatTranscript.renderReasoningSegments` и в основном блоке ответа:

Если `message.isFallback === true` — перед текстом ответа рендерить banner:

```html
<div class="ixplorer-chat__fallback-notice">
  <span class="ixplorer-chat__fallback-icon">⚠</span>
  <span>Research couldn't complete. Answer is based on partial results.</span>
</div>
```

CSS-класс `ixplorer-chat__fallback-notice`:
- `background: var(--background-modifier-error-rgb)` с opacity ~0.15
- `border-left: 3px solid var(--text-warning)`
- `padding: 6px 10px`, `border-radius: 4px`, `margin-bottom: 8px`
- `font-size: 0.88em`, `color: var(--text-warning)`

**Текст banner зависит от `fallbackReason`:**

| `fallbackReason`                     | Текст banner                                                          |
|--------------------------------------|-----------------------------------------------------------------------|
| `loop-detected`                      | Research got stuck in a loop. Answer is based on partial results.     |
| `model-round-limit-exceeded`         | Research reached the round limit. Answer is based on partial results. |
| `tool-call-limit-exceeded`           | Research reached the tool call limit. Answer is based on partial results. |
| `tool-result-budget-exceeded`        | Research hit the result size limit. Answer is based on partial results. |
| `context-limit-exceeded`             | Research hit the context limit. Answer is based on partial results.   |
| `multiple-mandatory-tools-unresolved`| Research could not retrieve required data. Answer is based on partial results. |
| `mandatory-repair-failed`            | Research could not retrieve required data. Answer is based on partial results. |
| (default)                            | Research could not complete. Answer is based on partial results.      |

Banner не коллапсируется и не скрывается — остаётся постоянно видим для сохранённых чатов.

### Изменения в `ResearchProgressCheckpoint` / chain

В summary-строке `<details>` при `isFallback`:
- Текст: `"Partial results · N rounds · T s"` (вместо `"Research progress · ..."`)
- Для `loop-detected`: `"Loop detected · N rounds · T s"`
- Цвет summary-строки слегка окрашен в warning (`var(--text-warning)`)

### Файлы, затронутые этим требованием

| Файл | Изменение |
|------|-----------|
| `src/research/AgenticResearchRunner.ts` | `+"loop-detected"` в `AgenticFallbackReason`; обнаружение петли после каждого раунда |
| `src/shared/types.ts` | `+isFallback`, `+fallbackReason` в `ResearchAnswer` |
| `src/research/ResearchService.ts` | Новая ветка при `!agentic.result.ok && evidence.length > 0` |
| `src/research/AnswerSynthesisService.ts` | `+fallback` в `AnswerSynthesisInput`, модификация system prompt, пробрасывание в `ResearchAnswer` |
| `src/ui/rendering.ts` | `+isFallback`, `+fallbackReason` в `ChatDisplayMessage`; обновление `attachAnswerDetailsToLastAssistantMessage` |
| `src/ui/ChatTranscript.ts` | Banner при `message.isFallback === true`; reason-специфичный текст; summary-строка для loop/partial |
| `styles.css` | `.ixplorer-chat__fallback-notice` |

---

## Принятые решения

1. **fetch_web_page label**: `tool-call-start` показывает `"Fetching page"` как placeholder. После завершения `AgenticResearchRunner` извлекает hostname из `value.finalUrl` (или `value.url`) результата и передаёт его как `resolvedLabel` в `tool-call-end` — UI обновляет лейбл.

2. **Checkpoint visibility**: checkpoint-элементы — часть цепочки. При `status: "superseded"` (финальный ответ поглотил checkpoint) элемент скрывается (`display: none`).

3. **Длина label**: query и прочие строки обрезаются до 60 символов с `…`.

4. **Дублированные вызовы**: cache-hit вызовы отображаются в цепочке как обычные (без пометки).
