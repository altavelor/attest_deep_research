# Шаг 1 — Доменные контракты дочерней сессии

Спецификация, не реализация. Источник требований — управляющая спецификация и уточнения
пользователя. Сейчас есть только SubAgentPort.run в src/application/research/subAgentPort.ts.
Все типы/модули ниже новые, кроме явно названных существующими.

## 0. Контракт шага

Потребляет существующие ResearchMode (src/core/research/researchMode.ts),
ResearchSearchMode (src/core/research/searchMode.ts), ChatDisplayMessage и inferChatTitle.
Производит новые экспортируемые типы SubAgentSessionSummary, SubAgentRunSummary,
SubAgentSourcePolicy, SubAgentScopeReduction, SubAgentCommand, RetrySubAgentCommand,
ParentRunBinding, ParentRunDeliveryContext, SubAgentCreateRecord, NormalizedUsage,
SubAgentBudgetPolicy, ImportedSubAgentRunOutcome, SubAgentRunReceipt, SubAgentRunRef,
SubAgentResultState, SubAgentSubmissionRecord, SubAgentSessionRecord, CreateSubAgentSessionInput,
ImportedSubAgentEvidenceReference, SubAgentSessionError и функции
applySubAgentTransition, reduceSubAgentSourcePolicy, deriveSubAgentTitle.
Публичная поверхность: существующий каталог src/core/research/subAgent/ (subAgentDirective.ts, subAgentFraming.ts,
subAgentTelemetrySummary.ts) получает curated index.ts, второго sibling-каталога не создаётся; внутренние файлы
sessionModel.ts, transitions.ts, sourcePolicy.ts, validation.ts, identity.ts.

## 1. Зачем

Долгоживущая сессия отличается от одного вызова runner: нормальное завершение позволяет
follow-up, ошибка — retry, а завершение родителя лишает сессию права на новые команды.
Эти правила должны проверяться без Obsidian или сетевой модели.

## 2. Модель данных

Имена в таблицах — поля новых типов; строки времени — UTC ISO 8601; ссылки — стабильные ID.

| Тип                      | Поля                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SubAgentSessionSummary   | subAgentSessionId, createRequestId, chatSessionId, parentRunId: string; bindingGeneration: number; status: SubAgentSessionStatus; title: string; sourcePolicy: SubAgentSourcePolicy; budgetPolicy: SubAgentBudgetPolicy; activeSubAgentRunId, pendingImportRunId: string или null; pendingImportGeneration: number или null; lastImportGeneration, runCount, revision: number; contextSummary: string или null; evidenceRegistryId, createdAt, updatedAt: string |
| SubAgentRunSummary       | subAgentRunId, subAgentSessionId, parentRunId, callerMode, command: string; origin: «direct» или «map_sources»; attempt, resultRevision: number; status: SubAgentRunStatus; phase: string или null; startedAt, completedAt: string или null; evidenceCount: number; usage: NormalizedUsage; terminalReason, resultSummary: string или null; effectiveSourcePolicy: SubAgentSourcePolicy; retryOfRunId, continuedFromRunId, budgetScopeId: string или null        |
| ParentRunBinding         | chatSessionId, parentRunId: string; bindingGeneration: number                                                                                                                                                                                                                                                                                                                                                                                                    |
| ParentRunDeliveryContext | deliveryEpoch: number; grantId: string                                                                                                                                                                                                                                                                                                                                                                                                                           |
| SubAgentCreateRecord     | createRequestId, normalizedInputDigest, candidateSessionId: string; status: «pending» или «published» или «denied»; publishedSessionId, terminalReason: string или null                                                                                                                                                                                                                                                                                          |
| NormalizedUsage          | необязательные inputTokens, outputTokens, totalTokens, reasoningTokens, cachedInputTokens, cacheCreationInputTokens: number; requestCount, modelRounds, toolCalls, durationMs: number; source: «provider» или «estimated» или «unavailable»                                                                                                                                                                                                                      |

SubAgentSessionStatus = ready | queued | running | importing | stopping | failed |
interrupted | archived. SubAgentRunStatus = queued | running | stopping | completed |
failed | interrupted. Поле revision монотонно увеличивается при принятом изменении;
повтор операции без изменения состояния revision не увеличивает.

SubAgentBudgetPolicy = { type: «local» } или { type: «required-scope»; scopeId: string }.
SubAgentSourcePolicy содержит searchMode: none | indexOnly | webOnly | indexAndWeb,
contextPaths: readonly string[], indexScope: «none»|«all-allowed»|«paths»,
allowActiveFile: boolean, allowNoteMutation: false. indexScope различает пустую область
и весь разрешённый индекс; для paths список непуст, для остальных пуст.
SubAgentScopeReduction содержит optional searchMode: none | indexOnly | webOnly,
contextPaths: readonly string[], allowActiveFile: false.

SubAgentCommand — discriminated union:

- { type: «initial»; task: string };
- { type: «follow-up»; task: string; scopeReduction?: SubAgentScopeReduction };
- { type: «continue-partial»; task: string; fromRunId: string; scopeReduction?: SubAgentScopeReduction }.
  RetrySubAgentCommand = { runId: string; scopeReduction?: SubAgentScopeReduction }.
  CreateSubAgentSessionInput (новый) = { createRequestId: string; title: string;
  maxSearches?: number; resources?: readonly string[]; scopeReduction?: SubAgentScopeReduction }.
  maxSearches/resources — дополнительные ограничения, не источник права доступа.

ImportedSubAgentEvidenceReference (новый): conversationEvidenceId, conversationSourceId,
conversationRevisionId, subAgentEvidenceId, subAgentSessionId, subAgentRunId, collectedAt:
string; attempt: number; incomplete: boolean.
ImportedSubAgentRunOutcome = { run: SubAgentRunSummary; answerText: string;
evidence: readonly ImportedSubAgentEvidenceReference[]; importId: string }.
Все поля публичного outcome должны удовлетворять правилам aliases шага 5.

Новый SubAgentRunRef = {sessionId:string;runId:string}.
Новый SubAgentRunReceipt = {sessionId:string;runId:string;submissionId:string;acceptedAt:string}.
Receipt — подтверждение durable queued, не результат и не обещание успешного исполнения.
Новый SubAgentResultState =
{state:«pending»;run:SubAgentRunSummary;importError?:{code:string;message:string}} |
{state:«completed»;outcome:ImportedSubAgentRunOutcome} |
{state:«failed»|«interrupted»;run:SubAgentRunSummary;error:{code:string;message:string}}.
Каждый вариант SubAgentResultState содержит resultRevision:number — стабильную версию
публичного результата из run.resultRevision (начальное значение 0), меняющуюся при новом
terminal success/failure, не при progress; validator старой секции subAgents нормализует отсутствие в 0.
Run completed при session importing возвращает pending до завершения попытки импорта,
без raw answer. Исчерпанный import даёт state=failed/error=import-failed даже при
run.status=completed: исход исполнения и доступность зарегистрированного результата различны.
Новый SubAgentSubmissionRecord = {submissionId,sessionId,normalizedCommandDigest:string;
runId:string;receipt:SubAgentRunReceipt}; сохраняется атомарно с queued run.
Повтор той же команды/host-derived submissionId возвращает тот же receipt, а не новый run;
другой digest под тем же ключом — idempotency-conflict. Это относится и к retry/follow-up.

chatSessionId — durable ChatSessionState.chatId, а не временный state.sessionId.
Перед созданием ребёнка chatId обязан существовать; view/runtime sessionId нужен только UI.
Новый SubAgentSessionError имеет code:string, message:string, details?:readonly JSON-data.
Коды: invalid-state, not-authorized, fenced-delivery, idempotency-conflict, invalid-input,
source-scope-denied, budget-denied, budget-port-error, import-failed, checkpoint-corrupt,
persistence-failed. Сообщения — фиксированные безопасные тексты нового errors-модуля;
not-authorized для чужого и отсутствующего ID одинаков: «Нет доступа к сессии.».
Direct tool input errors сохраняют прежние codes/messages SubAgentTool, адаптер не ломает API:
validation.ts экспортирует validateSubAgentTaskInput, readSubAgentSearchBudget и validateSubAgentResources,
возвращающие те же коды (task-too-long, invalid-max-searches, invalid-resources) и тексты, которые адаптер
просто пробрасывает; U7–U9 проверяют именно эти функции.

## 3. Переходы

Новая applySubAgentTransition(record, transition) возвращает success с новым record либо
SubAgentSessionError без побочных эффектов. Record (новый SubAgentSessionRecord) содержит
session: SubAgentSessionSummary и runs: readonly SubAgentRunSummary[].

| Событие                      | Предусловие                                             | Run                                                                   | Сессия                         |
| ---------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------ |
| initial                      | ready, runCount=0                                       | новый queued, attempt=1                                               | queued                         |
| scheduler-start              | queued, допуск к исполнению получен                     | running                                                               | running                        |
| runner-completed             | running                                                 | completed, usage/result сохранены                                     | importing                      |
| import-committed             | importing или failed с pending import, та же generation | completed                                                             | ready                          |
| import-failed                | importing, та же generation                             | completed без изменения                                               | failed, pending-поля сохранены |
| provider-failed              | running                                                 | failed                                                                | failed                         |
| execution-denied/port-error  | queued                                                  | failed                                                                | failed                         |
| model stop/timeout           | queued/running/stopping                                 | interrupted                                                           | interrupted                    |
| stop import                  | importing                                               | completed без изменения                                               | archived с tombstone import    |
| follow-up                    | ready, runCount>0                                       | новый queued, attempt=1                                               | queued                         |
| retry                        | failed/interrupted, terminal head                       | новый queued, attempt=предыдущий+1, pending import получает tombstone | queued                         |
| continue-partial             | failed/interrupted, terminal head                       | новый queued, attempt=1                                               | queued                         |
| user-archive                 | любое не archived                                       | nonterminal → interrupted, pending import получает tombstone          | archived                       |
| parent-closed                | любое не archived                                       | nonterminal → interrupted, pending import получает tombstone          | interrupted при прерванной работе, иначе без изменения |

Import-failed фиксирует исчерпанную попытку импорта (ошибка или deadline шага 5): сессия в failed,
run остаётся completed, pendingImportRunId/pendingImportGeneration не очищаются, чтобы reconciliation
живого parent мог дать import-committed. Follow-up в failed отклоняется, retry разрешён и повторно
исполняет run, поэтому ставит tombstone на pending import прежней generation (его importId не
возобновляется). Любой archive сессии ставит tombstone на pending import той же транзакцией.
Terminal run атомарно очищает activeSubAgentRunId. Importing сохраняет pending run/generation;
успешный commit очищает pending-поля, но никогда lastImportGeneration.
Retry хранит retryOfRunId и повторяет исходную команду с чистым рабочим transcript и
read-only priorEvidence. Partial хранит continuedFromRunId и использует прежнюю summary/
partial result. Обычный follow-up сохраняет session ID и использует bounded context.
Ссылка на не-current terminal head, чужой run, importing или параллельный run отклоняется.
Parent-closed (решение 16 управляющей спецификации) не архивирует: сессия продолжается
следующим родительским запуском чата. Command/retry принимают parentRunId/bindingGeneration
вызывающего запуска: новый run получает их, сессия переносит на них владельца.
User-archive окончательно закрывает сессию; model stop может оставить право retry.
Повтор user-archive не создаёт новый run, событие или изменение revision.
Уточнения реализации: событие stop-requested переводит running в stopping у сессии и run;
из stopping допустимы model-stop и provider-failed. Строка import-failed оставляет статус run
completed, но увеличивает resultRevision, потому что публичное состояние результата становится
failed/import-failed. Tombstone import возвращается переходом отдельно от записи
(tombstonedImport) и поднимает lastImportGeneration до max(last, pending).
Когда retry, continue-partial, follow-up-путь с tombstone или archive/stop-import отменяют pending import, resultRevision
завершённого run увеличивается: его публичное состояние меняется с failed/import-failed на interrupted/import-cancelled.

## 4. Валидация и права источников

Новая reduceSubAgentSourcePolicy(maximum, reduction) не расширяет права:
indexAndWeb → none/indexOnly/webOnly; indexOnly/webOnly → none; none → none.
contextPaths после канонизации — подмножество maximum; true active-file может стать false.
Пустой список maximum трактуется по исходного grant, а не как разрешение на весь vault.
В grant хранится явная область «весь разрешённый индекс» либо конкретные пути;
пустой reduction.contextPaths означает отсутствие доступа к индексным документам.
Retry проверяет сужение относительно effectiveSourcePolicy указанного run.
Никакие task/title/поля модели не задают callerMode, budgetPolicy или captured active-file.
Контроллеры, provider clients и итераторы в record не попадают.

Существующие границы прямого SubAgentTool сохраняются: task <=2000 символов, до восьми resources
по <=120 символов, maxSearches по существующей политике readSearchBudget: конечное целое значение
ограничивается диапазоном 1–20, default 8. Дробь/NaN/Infinity — ошибка; целое вне диапазона
нормализуется до границы, а не ломает совместимость прежнего tool input. Пустая task и NaN/Infinity запрещены. Внутренняя compiled task map_sources <=8192
допускается только trusted grant origin=map_sources; модель не выбирает этот обход.
deriveSubAgentTitle(task: string): string использует общую с inferChatTitle pure-политику:
нормализация пробелов, первые 77+«...» при длине >80. Сначала применяется безопасная
проекция текста; оригинальная валидированная команда хранится отдельно.

## 5. Критерии и тесты

Новый tests/unit/sub-agent-session-model.test.ts; shared builders — tests/support.
План роста: +10 unit cases, +0 scenario. Каждый ID ниже — один случай:

- U1: initial→queued→running→importing→ready→follow-up по таблице переходов;
  проекция outcome и различие receipt/результат проверяются в шаге 3, не здесь.
- U2: отказ follow-up в importing/queued/failed-с-pending-import без изменения record; мутант снятой проверки.
- U3: retry/partial различают context/attempt/lineage; неверный terminal head отвергается: входом служит terminal head, не являющийся текущим для этой session.
- U4: terminal очищает active, import хранит last generation, import-failed оставляет pending-поля, а retry/archive
  ставят tombstone; мутант повторного поколения.
- U5: model-stop и user-archive различаются, повтор archive идемпотентен.
- U6: subset source policy и retry narrowing; ловит web/path/active-file escalation.
- U7/U8: task на границе 2000/сверх границы; failure code вместе с текстом один раз.
- U9: невалидные resources/search budget/числа; проверяемые значения в одном request.
- U10: session/run isolation и запрет второго run на том же record.
  Существующие title-проверки в tests/unit/chat-store.test.ts переносятся на общий helper
  без добавления дублирующего правила; политика заголовка остаётся неизменной.

Проверка: npm run typecheck:core; npm test -- --run tests/unit/sub-agent-session-model.test.ts;
npm run check. После шага текущие stateless вызовы не меняются.
Объединение/удаление старых title cases допускается только после трёх differential mutants.

## 6. Отложено

Async-правила manager, persistence и UI находятся в последующих шагах; значения новых
идентификаторов не используются как доказательство авторизации.
