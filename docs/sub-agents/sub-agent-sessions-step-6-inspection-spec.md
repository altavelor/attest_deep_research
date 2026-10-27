# Шаг 6 — Контракт наблюдения и пользовательской остановки

Спецификация. Сейчас SubAgentTelemetry содержит final counters, SubAgentRunner.run собирает
messages перед ThinkingResearchRunner, но initial prompt/child model/sessions не доступны UI.
Существующие файлы: application/research/subAgentPort.ts,
application/use-cases/research/sub-agent/SubAgentRunner.ts, core/chat/savedChat.ts.

## 0. Контракт шага

Потребляет SubAgentSessionManager, SubAgentDelegator, SubAgentLifecycle из шага 3;
SubAgentSessionSummary, SubAgentRunSummary, NormalizedUsage, deriveSubAgentTitle из шага 1;
SubAgentStateSnapshot из шага 2; зарегистрированный outcome шага 5.
Производит новые inspection DTO в src/application/contracts/subAgentInspection.ts;
чистые persisted SubAgentDispatchEntry/SubAgentWorkflowItem/SubAgentInitialPrompt/
SubAgentModelSnapshot/SubAgentObservationEvent/SubAgentNoticeEntry — в новом core/research/subAgent/observationModel.ts.
Core SavedChat импортирует только core DTO, никогда application contracts.
Производит порт SubAgentInspectionPort в src/application/ports/subAgent.ts:

```ts
interface SubAgentInspectionPort {
  snapshot(): Promise<SubAgentInspectionSnapshot>;
  getSession(sessionId: string): Promise<SubAgentInspectionDetail | null>;
  subscribe(listener: (snapshot: SubAgentInspectionSnapshot) => void): () => void;
  stopFromUser(sessionId: string, expectedRunId: string | null): Promise<SubAgentUserStopResult>;
}
type SubAgentUserStopResult = "stopped" | "already-terminal" | "stale";
```

Новый SubAgentInspectionSnapshot = {revision:number; activeCount:number; hasAgentRuns:boolean;
sessions: readonly SubAgentSessionCard[]}.
Новый SubAgentSessionCard: sessionId,parentRunId,description:string; revision:number;
status:SubAgentSessionStatus; model:SubAgentModelSnapshot|null;
usage:NormalizedUsage; usageIncomplete:boolean; elapsedMs:number; updatedAt:string;
canStop:boolean; controlRunId:string|null. Новый SubAgentModelSnapshot = {profileId,providerId,modelId,label:string}.
Новый SubAgentInspectionDetail = {card:SubAgentSessionCard;
runs: readonly SubAgentRunSummary[]; selectedRunId:string|null;
initialPrompts: readonly SubAgentInitialPrompt[]; lifetime: readonly SubAgentWorkflowItem[]}.

Новый SubAgentInitialPrompt = {runId:string; capturedAt:string|null;
state:«captured»|«not-started»|«unavailable»|«evicted»;
messages: readonly {role:«system»|«user»|«assistant»|«tool»;content:string}[];
redacted:boolean; truncated:boolean; unavailableReason?:string}.
Новый SubAgentWorkflowItem = {id,sessionId,runId,name,label:string; sequence:number;
round:number; status:«pending»|«complete»|«failed»; startedAt:string; completedAt?:string;
args?:Record<string,unknown>; resultSummary?:string; resultJson?:string;
badge?:{text:string;tooltip?:string};
payloadState:«captured»|«disabled»|«evicted»|«truncated»}.
Новый SubAgentDispatchEntry = {eventKey,sessionId,runId,parentRunId,body,createdAt:string;
commandKind:SubAgentCommand[«type»]|«retry»; attempt:number; sequence:number}.
Новый SubAgentNoticeEntry = {eventKey,parentRunId,description,createdAt:string;
sessionId:string|null; batchId?:string; runId:string|null; sequence:number;
kind:«created»|«queued»|«not-started»|«finished»|«partial»|«failed»|«stopped»|«interrupted»|
«import-failed»|«closed»|«batch»; durationMs?:number; usage?:NormalizedUsage;
modelLabel?:string; reasonCode?:string; replyExcerpt?:string; replyTruncated?:boolean;
batch?:{total:number;done:number;running:number;failed:number}; closedCount?:number}.
Расширяет SubAgentRunSummary optional полем model?:SubAgentModelSnapshot и validator
секции subAgents: это исторический snapshot конкретного run, доступный в detail.runs.
Расширяет SubAgentHost методом inspection():SubAgentInspectionPort; factory/context
шага 3 сохраняют сигнатуры. SubAgentInspectionService получает внутренние snapshot/subscribe
callbacks manager, наружу выдаёт immutable DTO и scoped stop closure без manager reference.
Производит новый SubAgentInspectionService и capture-callback
onObservation(event: SubAgentObservationEvent): void в SubAgentExecutionRequest шага 3.

## 1. Snapshot, активность, длительность, модель

activeCount = число card.status=running ровно текущего чата. Он не считает parent,
queued, importing, stopping, ready, terminal или сессии другого чата.
hasAgentRuns=true после первого durably принятого initial run (включая queued),
иначе false. Одно create без run и отклонённая до принятия команда не меняют признак.
Признак выводится из сохранённой истории запусков/runCount, переживает reload и очистку
подробных diagnostics; число running и пустота текущей страницы списка его не определяют.
Список: running сначала; внутри групп updatedAt по убыванию, затем sessionId лексикографически.
Никакой произвольной сортировки по различным часам провайдера.

Description создаётся из первой исходной команды через deriveSubAgentTitle один раз.
Follow-up/retry не переименовывает сессию и не вызывает дополнительный LLM-запрос.
Заголовок не заменяет полный task для исполнения. После redaction он остаётся безопасным текстом.
Модель захватывается из реально выбранного provider/model config, до первого model call;
не из текущего dropdown после переключения. Card показывает выполняемый либо последний run.
Для queued без предыдущего run показывается выбранная конфигурация, при отсутствии — «нет данных».
При смене модели между runs история хранит отдельные model snapshots.

elapsedMs — сумма длительностей исполнения всех attempts, включая synthesis fallback,
без ожидания очереди, import и интервалов между follow-up. Running добавляет прошедшее
время текущего исполнения; completed фиксирует длительность. Monotonic clock runtime
защищает от перевода системных часов, persisted accumulated time не включает downtime.
Для queued первого run elapsed=0; после crash не растёт. Таймер UI не сохраняет snapshot
каждую секунду и не инициирует model request.

Usage суммируется по уникальному runId/requestId, live usage заменяется final для того же
ключа, не добавляется второй раз. Несколько attempts считаются раздельно.
Только reported finite nonnegative tokens: totalTokens берётся из provider total либо
input+output, если обе величины известны; reasoning/cache отображаются как компоненты,
не прибавляются второй раз. Missing поля остаются missing, нули не трактуются как unknown.
Для неполной суммы показываются известные токены с признаком «частично»; без данных — «—».
Provider/cached fields не изобретаются из существующих нулевых defaults collector.
Synthesis fallback также испускает usage с отдельным requestId и учитывается в общем run;
финальное событие не прибавляет уже учтённые rounds/fallback повторно.
Добавить optional reported-usage presence metadata к результату model round collector;
сохранить нынешние diagnostic counters для совместимости. Cost не вычисляется.

## 2. Захват начального prompt и lifetime

Новый SubAgentObservationEvent — discriminated union:

- model-started: runId, model:SubAgentModelSnapshot, prompt:SubAgentInitialPrompt;
- usage: runId, requestId:string, usage:NormalizedUsage, final:boolean;
- tool-start/tool-end: item:SubAgentWorkflowItem;
- phase: runId, phase:string, occurredAt:string.
  Каждый event проверяет session/run/fence generation и обновляет read projection, не CoT.
  Новый SubAgentObservationRecord расширяет payload envelope шага 2 этими discriminants.
  Prompt и model metadata хранятся отдельно на run, импорт evidence их не затрагивает.

Prompt захватывается один раз перед первым modelRound.runRound уже собранного запроса:
system framing, task и реально включённый prior context. Не подменять его короткой task.
Provider headers, API keys, connection settings, raw tool-result history и reasoning исключены.
Снимок не содержит сгенерированного ответа; для follow-up/retry — собственный initial snapshot.
Чувствительные части редактируются до записи/DTO, UI явно сообщает redacted/truncated.
Лимит снимка 64 Ki символов на run, граница сообщения не теряет role; дальнейшее отмечено.
До первого запроса — not-started; старые сессии — unavailable; вытеснено лимитом размера чата — evicted.
Промпт доступен вне debug, редактирование/повторный запуск из UI запрещены.

Новые tool callbacks используют имеющиеся onToolCall(args) и onToolResult(resultJson)
ThinkingResearchRunner/ThinkingToolRoundExecutor; сейчас SubAgentRunner их payload отбрасывает,
это устраняется. Pending→terminal обновляет один ID (session/run/call), без дубликатов;
sequence сохраняет порядок принятия внутри session, параллельные calls не сортируются по end.
Только debug-at-capture разрешает args/resultJson; выключение debug сразу скрывает их,
включение позже показывает «не записано», не запускает запрос заново.
badge формируется при capture из redacted данных независимо от debug и содержит только безопасный код
без текста провайдера; child mapper передаёт badge, а не resultJson.
Порядок: сначала redaction полного текста, затем cap; cap не режет redaction marker, иначе префикс секрета на границе лимита сохранился бы.
Redaction до capture, output до 32 Ki символов на call и до 256 Ki на run; при превышении
компактный label/status остаётся, payloadState=truncated. Результат не CoT и не raw response.
Применяется лимит подробностей чата из шага 2, вытесненное явно помечено evicted.

Dispatch entry создаётся только для durably queued команды с origin=direct (команды workers
map_sources записей в main не создают) и с фактической task, safe body,
стабильным eventKey из полной tuple identity, timestamp и main chronological sequence.
Create/metadata/progress/ответ ребёнка сами по себе не создают DispatchEntry.

Notice создаётся по переходу жизненного цикла: created (или queued при ожидании слота) —
после durable create; not-started — при отказе бюджета до старта (очередь FIFO не отказывает); finished/partial/
failed/stopped/interrupted/import-failed — один на terminal run, только после durable import
или его bounded отказа; closed — один на parent terminal с closedCount, создаётся только если closedCount>0;
batch — одна запись на batch map_sources, workers собственных notices не имеют.
eventKey строится из полной identity и kind, повтор и replay идемпотентны: для closed это (parentRunId, closed),
для batch — (chatId, parentRunId, batchId, batch), sessionId у них null. Batch-запись upsert по eventKey:
счётчики заменяются только значением с не меньшим done+failed, sequence сохраняется от первой вставки;
источник обновлений — MapSources шага 9 через sink шага 8, в шаге 6 batch не создаётся. Описание — по
общей политике заголовка до 80 символов. replyExcerpt — redacted ответ ребёнка не более
4 KiB с replyTruncated; полный результат модель получает отдельным путём шага 5. reasonCode —
безопасный код без текста провайдера; текст interrupted зависит от него: plugin-unload и crash-recovery —
«Obsidian was closed or reloaded», остальные причины (остановка модели, timeout) — своя безопасная формулировка. Progress, фазы, tool calls и usage preview notices не
создают. Notice создаётся тем же post-transition intent и sink, что и dispatch.
Ретрай создаёт новую отправленную команду нового run; повтор create/import — нет.
Event intent создаётся под manager lock, передаётся chat sink off-lock; порядок задаёт
общий parent sequence allocator шага 8. Старый epoch не создаёт новую main-visible запись.

## 3. Stop-only capability и безопасность

InspectionPort создаётся runtime для одного чата, историческое чтение разрешено после
parent terminal. UI не получает manager, SubAgentDelegator или grantId.
stopFromUser проверяет chat-scoped capability, sessionId и expectedRunId по текущей попытке. controlRunId в card — active run,
иначе pending-import run, иначе последний run; у сессии без запусков null.
Null совпадает только с отсутствием любого run и не является wildcard.
Обновление usage, phase, tool status, card.revision и завершение той же попытки не мешают
остановке. Новый run/retry меняет controlRunId: stale, обновить карточку без stop новой попытки.
При валидном запросе синхронно fences всю session, removes queue/aborts только её run,
tombstones import и окончательно архивирует; будущий follow-up/retry запрещён.
canStop и stopFromUser требуют активный run или pending import сессии и nonterminal
владеющий запуск; бездействующая сессия (в том числе из прежних ходов) — already-terminal.
Повтор archive = already-terminal. Parent завершился одновременно — already-terminal.
Ошибка durable archive = явная ошибка в modal; fence остаётся, retry acknowledgement
идемпотентен. Публикация укладывается в close protocol шага 3, без зависания UI.

Никакое reading DTO не содержит mutable record/reference или чужой session.
Prompt/tool result rendering text-only либо через проверенный текущий безопасный renderer,
без HTML injection. Redaction использует существующий redactSensitiveData из @shared
на application boundary через injected redactor: application не импортирует adapters.
DTO подписки coalesced, terminal/status гарантированно flush; unsubscribe отсоединяет
listener, но не останавливает manager. Budget meter maps очищаются после завершения run.

## 4. Критерии и тесты

Новые tests/unit/sub-agent-inspection.test.ts; +9 unit, +1 scenario в tests/scenario/sub-agent-observation.test.ts.

- U1: only running activeCount и стабильный active-first sort, queued/importing не считаются;
  в том же случае проверить hasAgentRuns: create без run=false, принятый queued=true,
  terminal/reload/очистка diagnostics сохраняют true.
- U2: immutable model snapshot, title первой task по общей chat naming policy.
- U3: elapsed без queue/gaps/downtime, фиксируется terminal; injected fake clock.
- U4: partial/missing/zero usage, live→final replacement, reasoning/cache без двойного счёта.
- U5: capture фактических messages первого запроса, bound/redaction/absence states.
- U6: tool updates идемпотентны, debug capture policy и payload caps/evicted markers; секрет пересекает границу
  cap (32 Ki, 256 Ki), и ни один его префикс не сохраняется.
- U7: stop capability foreign/replay; progress revision не делает stop stale;
  новый runId делает stale, null не совпадает с уже созданным run.
- U8: user archive idle-ready/running/importing, error acknowledgement не снимает fence.
- U9: outgoing dispatch только по accepted commands origin=direct, команда worker не создаёт dispatch;
  один notice на lifecycle-переход,
  идемпотентный replay, replyExcerpt redacted/bounded на границе 4 KiB;
  privacy: fixture подаёт в observation callback поле reasoning и секрет, оба отсутствуют в DTO и секции subAgents;
  секрет пересекает границу 4 KiB replyExcerpt, и ни один его префикс не сохраняется.
- S1: seam real execution adapter↔scripted modelRound: initial prompt + model + usage +
  tool args/result проходят именно реальным callback путём, не искусственным UI fixture.
  Редактировать существующие tests/unit/sub-agent.test.ts для расширенного event contract,
  не дублировать pure manager transitions и budgets. Expected growth для него 0 cases.

Команды: npm test -- --run tests/unit/sub-agent-inspection.test.ts tests/unit/sub-agent.test.ts;
npm run check. Inspection пока не подключён к UI.
