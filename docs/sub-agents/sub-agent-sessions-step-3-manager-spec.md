# Шаг 3 — Менеджер, права родителя и локальное исполнение

Спецификация. Все child-manager symbols ниже новые. Существующий stateless SubAgentPort
и текущий UI пока продолжают работать; новые модули тестируются через injected ports.

## 0. Контракт шага

Потребляет SubAgentSessionRepository, SubAgentStateSnapshot из шага 2 и
SubAgentSessionRecord, ParentRunBinding, ParentRunDeliveryContext,
CreateSubAgentSessionInput, SubAgentCommand, RetrySubAgentCommand,
ImportedSubAgentRunOutcome, SubAgentRunReceipt, SubAgentRunRef, SubAgentResultState,
SubAgentSubmissionRecord, SubAgentCreateRecord из шага 1; SubAgentDurableWriter из шага 2.
Производит новые интерфейсы в src/application/ports/subAgent.ts:

```ts
interface SubAgentDelegator {
  create(input: CreateSubAgentSessionInput): Promise<SubAgentSessionSummary>;
  getCreatedSession(createRequestId: string): Promise<SubAgentSessionSummary>;
  run(
    sessionId: string,
    command: Extract<SubAgentCommand, { type: "initial" }>,
    submissionId: string,
  ): Promise<SubAgentRunReceipt>;
  continue(
    sessionId: string,
    command: Exclude<SubAgentCommand, { type: "initial" }>,
    submissionId: string,
  ): Promise<SubAgentRunReceipt>;
  retry(
    sessionId: string,
    command: RetrySubAgentCommand,
    submissionId: string,
  ): Promise<SubAgentRunReceipt>;
  getResult(sessionId: string, runId: string): Promise<SubAgentResultState>;
  waitForResults(
    refs: readonly SubAgentRunRef[],
    options: SubAgentWaitOptions,
  ): Promise<SubAgentWaitResult>;
  stop(sessionId: string): Promise<void>;
}
interface SubAgentWaitOptions {
  mode: "any" | "all";
  timeoutMs: number;
  signal?: AbortSignal;
}
interface SubAgentWaitResult {
  ready: readonly SubAgentRunRef[];
  timedOut: boolean;
}
interface SubAgentLifecycle {
  closeAll(parentRunId: string, terminalReason: string): Promise<SubAgentCloseResult>;
  dispose(): Promise<void>;
}
interface SubAgentCloseResult {
  durable: boolean;
  recoveryMarkerPersisted: boolean;
  unsettledPermits: number;
  failures: readonly string[];
}
```

Новый SubAgentSessionManager реализует SubAgentLifecycle и
delegatorFor(binding: ParentRunBinding, delivery: ParentRunDeliveryContext): SubAgentDelegator.
Новый SubAgentHost extends SubAgentLifecycle добавляет тот же delegatorFor и
subscribeResults(listener: () => void): () => void — host-only сигнал изменения результатов;
listRunRefs(parentRunId: string): readonly SubAgentRunRef[] — host-only own-run lookup,
не раскрывающий записи другого binding. Результаты читаются через facade getResult.
Новые SubAgentWaitOptions/SubAgentWaitResult — экспортируемые типы этого шага.
Новый SubAgentSessionManagerFactory = (context: SubAgentSessionManagerContext) => SubAgentHost.
Новый SubAgentSessionManagerContext содержит getChatId():string|null, repository:SubAgentSessionRepository (чтение), writer:SubAgentDurableWriter,
execution:SubAgentExecutionPort, evidenceImport:SubAgentEvidenceImportPort,
getCurrentParentBinding():ParentRunBinding|null, getCurrentDeliveryEpoch():number,
resolveGrant(id:string):SubAgentDelegationGrant|null, now():Date,
createId(prefix:string):string. Новый SubAgentDelegationGrant содержит binding,
callerMode:string, budgetPolicy:SubAgentBudgetPolicy, maximumSourcePolicy:SubAgentSourcePolicy,
capturedActiveFilePath?:string, origin:«direct»|«map_sources» и limits:{maxRounds:number;
maxResultChars:number; maxSearches:number}. Budget/observation ports подключаются расширениями
следующих шагов, существующие поля контекста и сигнатуры не меняются.
Новые SubAgentExecutionPort.run(request: SubAgentExecutionRequest): Promise<SubAgentExecutionResult>
и SubAgentEvidenceImportPort.commit(request: SubAgentImportRequest): Promise<SubAgentImportResult>
вводятся как порты; формы DTO определяются в разделах ниже и дополняются шагами 4–6.
Реализации в новом src/application/use-cases/sub-agent/, curated index.ts.

## 1. Владение и grants

Manager получает getChatId/repository/writer и read-only binding/epoch probes конструктора.
getChatId допускает null у draft, но первая durable child-операция требует chatId и bind секции subAgents ровно один раз. Чтение draft inspection пусто, создания секции нет.
Runtime создаёт manager ровно один раз в конструкторе; manager не владеет top-level save.
Apps создают только factory/dependencies, но не singleton manager и не карту детей.
Runtime — единственный lifecycle owner; другие чаты не могут resolve/list/subscribe чужих.

Runtime регистрирует приватный grant по grantId: binding, callerMode,
immutable budgetPolicy, максимальная sourcePolicy и captured active-file path.
delegatorFor вызывается только runtime. Model/API create не принимает claims callerMode,
budgetPolicy или произвольный maximum scope. ID grant сам по себе не является claims.
Неподходящий mode/чужой/поддельный/stale ID отклоняется до allocation и persistence.
Для Thinking — local, для будущего Deep Research — required-scope; строка в task это не меняет.

Каждая mutation проверяет binding внутри serial transition: chat, текущий nonterminal parent run и bindingGeneration должны точно совпасть с private probe, generation не revoked.
Чужой ID и чужой binding дают одинаковый not-authorized ответ без раскрытия состояния.
Продвижение deliveryEpoch не отзывает binding; старый facade только теряет delivery.
Матрица source policy и retry — из шага 1, не повторяется в UI или адаптере.

## 2. Idempotent create

createRequestId выводит host из стабильной tool invocation identity; модель его не задаёт.
Перед async-операциями persist SubAgentCreateRecord со stable candidateSessionId.
Digest охватывает grant, title, maxSearches/resources и scopeReduction после нормализации.
Повтор того же ID/входа присоединяется к pending и возвращает тот же published session
либо сохранённый denial. Другой digest = idempotency-conflict; второй session не появляется.
getCreatedSession восстанавливает доставку той же записи через новый epoch facade.
Все три вида mappings живут до окончания parent-run и участвуют в bounded recovery.
Схема required-scope publication включается только после шага 4.

## 3. Очередь и запуск

Нормативный local capacity — четыре одновременных child run на chat; FIFO без общей очереди
между чатами. Это сохраняет возможность четырёх document workers, не занимая top-level slots.
Перед enqueue атомарно persist команду, новый run ID, queued и SubAgentSubmissionRecord.
Host-derived submissionId обязателен для каждой initial/follow-up/partial/retry команды и строится из
parentRunId, индекса model round родительского вызова и callId: callId сам по себе не уникален
(text-parsed провайдеры выдают text_call_0 в каждом ответе);
replay того же digest возвращает прежний receipt, а conflict не создаёт попытку.
После durable приёма и dispatch barrier вернуть receipt, не ожидая runner или import. Queue entry не имеет controller,
model client или iterator. Одна session не может иметь две queued/running команды.

После capacity и допуска persist scheduler-start, затем allocate runtime resources.
Новый SubAgentExecutionRequest содержит session/run IDs, attempt, task, sourcePolicy,
resources, limits, priorContext, signal и безопасный callback наблюдения (расширит шаг 6).
Prior context: summary, прежний результат и priorEvidence; retry исключает старый рабочий
transcript, partial включает явную предыдущую partial summary. Compaction bounded до старта.
Новый SubAgentExecutionResult содержит answerText, evidence, usage, incomplete,
terminalReason и telemetry. Модель не выбирает рабочие limits из task.
Новые SubAgentImportRequest = {sessionId,runId,result: SubAgentExecutionResult};
SubAgentImportResult = {outcome: ImportedSubAgentRunOutcome}. Port реализует шаг 5.

Runner-completed сохраняет результат и importing, затем вызывает import port off-lock.
getResult возвращает completed только с ImportedSubAgentRunOutcome после успеха port и
CAS/epoch проверок; пока bounded import выполняется — pending, после его failure/timeout
getResult даёт failed/import-failed. Prepared result остаётся для recovery без raw answer. Получение receipt не отменяется задним числом из-за ошибки исполнения.
После receipt runner errors отражаются через getResult/subscribeResults, не rejected start promise.
До шага 5 это seam с fake import port, production-потребителей нового manager нет.

Каждая submission promise завершается receipt либо ошибкой приёма ровно один раз.
Ошибка scheduler-start после receipt даёт terminal run, а не подвисший результат или слот.
Уведомление результата создаётся после durable terminal/import commit; повторный callback
не создаёт второе исполнение. Delivery по epoch может повториться с тем же runId.

getResult — снимок статуса без ожидания модели/поиска; pending не запускает ещё один run.
Восстановление import инициируется отдельно, не превращает запрос статуса в длинный await.
waitForResults сначала подписывается на изменения и только затем снимает snapshot через listRunRefs/getResult,
чтобы сигнал между этими шагами не потерялся; не опрашивает модель/диск в цикле. mode=any/all
учитывает completed/failed/interrupted, но не completed run в importing; timeout 0–30000 ms,
0 — немедленная проверка. Timeout/отмена wait не останавливают дочерние runs.
Завершение/timeout/fencing снимает listener и timer; ready содержит только запрошенные refs.
Cleanup в finally закрывает iterator/controller и освобождает capacity даже при игнорируемом
провайдером abort: timeout fences прекращает публичное ожидание, late completion отбрасывается.

## 4. Stop и close barrier

Model stop(sessionId) сохраняет семантику шага 1. Пользовательский окончательный archive
реализует другой capability шага 6; он не вызывает фасад модели из UI.
Stop синхронно fences target queued/run/import; queued удаляется без allocation, running
получает abort, importing — tombstone. Durable acknowledgement после terminal записи.
Повторы не плодят события или saves. Stale/foreign stop не воздействует на другие сессии.

closeAll сначала синхронно revoke binding и fences всё parent-owned work, затем асинхронно
закрывает и сохраняет. Общий deadline закрытия — 2000 ms, включая load, primary drain,
publication обязательных событий и fallback marker; последовательные этапы не получают
каждый новый двухсекундный бюджет. Primary drain имеет до 1500 ms, последние 500 ms
зарезервированы на marker в chat repository. При ранней ошибке marker стартует сразу.
Marker barrier имеет приоритет: он отменяет ещё не начатый ожидающий batch и входит в следующий
commit, но запись в полёте отменить нельзя. Если она зависла, marker не может быть записан, и исход
durable=false/recoveryMarkerPersisted=false определён и допустим; медленная, но завершающаяся запись —
дефект производительности (L1).
Каждый timeout снимается после успеха/ошибки; Promise.race не считается отменой операции.
Marker пишется отдельным barrier без .prev (шаг 2). Если marker тоже недоступен, результат durable=false/recoveryMarkerPersisted=false;
parent terminal можно публиковать после исчерпания deadline, binding не восстанавливается.
Поздний load/save обрабатывает terminal fence и никогда не запускает ребёнка.
Все pending submission/wait deliveries при close/dispose завершаются fenced. Dispose оставляет только
settlement-продолжение для незавершённых промисов бюджетного порта: оно не держит controller и iterator, не
ограничено deadline закрытия и заканчивается, когда порт ответил; поздний grant получает settle
not-started. Действия, не завершённые к deadline закрытия 2000 ms, сохраняются как unknown и считаются в
SubAgentCloseResult.unsettledPermits. Close и dispose секцию subAgents не удаляют: она удаляется только вместе с файлом чата.

## 5. Критерии и тесты

Новые tests/unit/sub-agent-session-manager.test.ts и shared fakes tests/support/subAgentSessions.ts.
План роста +12 unit, +2 scenario в tests/scenario/sub-agent-manager-import.test.ts; правило доменных переходов повторно не тестируется.

- U1: два manager имеют независимые IDs/queue/cleanup и не раскрывают чужую session.
- U2: grant/binding checks, смена parent generation и запрет model claims.
- U3: create pending join и submission replay/digest conflict без второго session/run.
- U4: FIFO/capacity/одна session; queued не создаёт runner resources.
- U5: ошибка приёма не даёт receipt; ошибка runner после receipt даёт terminal result,
  parent независимая работа начинается до release gate ребёнка.
- U6: follow-up/retry/partial передают различные bounded contexts, без проверки текста LLM.
- U7: queued stop не запускает runner; late ignored abort не доставляет outcome.
- U8: parent close синхронно fences до любого await и отклоняет известные promises.
- U9: общий deadline с зависшими load/drain/timeline/marker через fake clock;
  не assert duration, а продвинуть runPastDeadline и проверить result/fences.
- U10: timer/observer/controller ресурсы освобождены, остаются только settlement-продолжения без controller и
  iterator (мутант: продолжение сброшено), повтор dispose идемпотентен.
- U11: wait any/all учитывает только запрошенные terminal refs, importing остаётся pending; сигнал,
  пришедший между подпиской и snapshot, не теряется (мутант: snapshot до подписки).
- U12: wait timeout/cancel/fencing снимает подписку/timer без stop дочернего run.
- S1: seam manager↔fake import port: receipt возвращён при blocked runner;
  pending/importing не выдаёт answer, durable outcome разрешает follow-up;
  тест не повторяет registry-валидацию шага 5.
- S2: seam реальный ChatWriteBuffer↔зависший fake repository: marker не ждёт зависшую запись дольше бюджета.

Команды: npm test -- --run tests/unit/sub-agent-session-manager.test.ts
tests/scenario/sub-agent-manager-import.test.ts; npm run typecheck:core; npm run check. Пока ResearchService использует прежний stateless путь.

## 6. Отложено

Required scopes — шаг 4; реальный import/recovery/epochs — шаг 5; inspection и пользовательский
archive — шаг 6; подключение к runtime — шаг 8.
