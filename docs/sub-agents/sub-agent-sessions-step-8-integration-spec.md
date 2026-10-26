# Шаг 8 — Интеграция с chat runtime и Thinking

Спецификация. Существующие ChatSessionRuntime/ChatSessionManager/chatSessionTypes.ts
находятся в src/application/use-cases/chat/; composition —
src/apps/obsidian/composition/chatSessionFactory.ts и factories.ts.
ResearchService, SubAgentRunner и ThinkingResearchStrategy — в application/use-cases/research/.
Основной tool — src/adapters/research-tools/sub-agent/SubAgentTool.ts.

## 0. Контракт шага

Потребляет SubAgentSessionManagerFactory, SubAgentDelegator, SubAgentLifecycle
из шага 3; SubAgentRunRef, SubAgentRunReceipt, SubAgentResultState из шага 1; SubAgentBudgetPermitPort из шага 4; SubAgentEvidenceImportPort,
SubAgentImportedEvidenceResolver из шага 5; SubAgentInspectionPort,
SubAgentDispatchEntry, SubAgentNoticeEntry и SubAgentInspectionService из шага 6;
renderWorkflowTimeline и WorkflowTimelineModel из шага 7.
Потребляет существующие ChatSessionRuntime, ChatSessionManager, ChatSessionState,
ChatSessionChangeKind, ResearchService.answer, ChatRepository, EvidenceRegistry.
Производит новые:

- ChatSessionEnvironment.createSubAgentSessionManager: SubAgentSessionManagerFactory;
- ChatSessionManager.getSubAgentInspection(sessionId: string): SubAgentInspectionPort | null;
- ChatTimelineItem = {kind:«message»; sequence:number; message:ChatDisplayMessage} либо
  {kind:«agent-dispatch»; sequence:number; dispatch:SubAgentDispatchEntry} либо
  {kind:«agent-notice»; sequence:number; notice:SubAgentNoticeEntry};
- ChatSessionState.subAgentDispatches: readonly SubAgentDispatchEntry[],
  subAgentNotices: readonly SubAgentNoticeEntry[], timelineSequence:number;
- ChatDisplayMessage.timelineSequence?:number — новое additive поле существующего типа;
- ChatSessionChangeKind расширен значением «sub-agents»;
- ResearchRequest.subAgentDelegator?: SubAgentDelegator;
- новый ChatSubAgentBridge для chat-owned dispatch sink и inspection forwarding;
- новый session-backed SubAgentTool путь с receipt запуска и отдельной доставкой результата.

## 1. Composition и жизненный цикл

Runtime получает factory, создаёт manager в конструкторе один раз и хранит readonly поле,
без общего child registry. Context.getChatId возвращает null для draft; manager существует
только в памяти, не bind секции subAgents до durable chatId. Inspection draft даёт пустой snapshot.
При первом create секция subAgents связывается с durable chatId навсегда; повторная привязка
к другому ID отвергается. Binding и chatSessionId всегда используют durable ID.
Manager top-level знает только runtimes, getSubAgentInspection делегирует выбранному runtime;
ни сам UI, ни composition не сохраняют manager instance или mutable child records.
Неиспользованный draft не создаёт секцию subAgents. Durable chatId существует до child create,
так как ChatSessionManager.beginRun сохраняет run-start перед launch.
Сбой этого save не создаёт binding, child run, provider contact или временные файлы и не
повторяется в фоне: снимок отбрасывается, beginRun возвращает started:false.

execute выдаёт binding/grant/epoch и передаёт facade через ResearchRequest.
ResearchService перестаёт конструировать runner для direct run_subagent; execution adapter
создаёт SubAgentRunner с прежними ports/model configuration только при scheduler start.
Runner остаётся engine, не владельцем session lifecycle или UI state.
Captured activeFilePath берётся из ChatRunRequest, а не выбранной сейчас вкладки.

Порядок parent finish/stop/dispose без chat serializer: revoke/fence через child host
closeAll → bounded durability protocol → terminal parent save/clear activeRunId → release
slot/promote next top-level chat. Отзыв generation до terminal publication обязателен. Если closeAll исчерпал deadline, а terminal save всё
ещё ждёт зависшую запись, слот освобождается и in-memory terminal публикуется; save остаётся ожидающим barrier,
который вытесняет более старые.
Discard idle draft, delete chat, unload и crash recovery освобождают только свой manager.
View.close/переключение чата не отменяет фоновые children. Parent suspension меняет epoch,
а не binding; new delegator использует getCreatedSession/getResult.
При chat delete удаляется файл чата вместе с секцией subAgents, pending saves не воскрешают его.
ChatSessionManager сохраняет чат только через ChatWriteBuffer runtime (шаг 2): run-start,
terminal и прерывание при выгрузке — barrier; исключение — startup recovery normalizeStaleChats
без runtime (шаг 2 §3). Буфер создаётся в конструкторе runtime до chatId, первый save нового
чата идёт с chatId=null, и ни один дочерний delta не принимается до привязки chatId.

## 2. Совместимость Thinking tool

Существующий input task/maxSearches/resources сохраняет смысл и границы. Новый wire-ответ
run_subagent — {state:«accepted»;receipt:SubAgentRunReceipt}, без answer/snapshot.
Host-derived call identity задаёт createRequestId и submissionId из parentRunId, индекса model round и callId
(callId сам по себе не уникален между rounds у text-parsed провайдеров: text_call_0). Initial создаёт session,
run подтверждает durable queued; после receipt parent model loop сразу может сделать
следующий model round/свои tools, пока ребёнок заблокирован на provider.
Follow-up/partial/retry тоже возвращают receipt; cached/replayed call не создаёт второй run.

Новые model tools get_subagent_result({sessionId,runId}) возвращает SubAgentResultState и
wait_subagents({refs,mode,timeoutMs}) возвращает SubAgentWaitResult из шага 3.
Они не расширяют права, доступны только в owning facade; timeout/cancel wait не stop ребёнка.
Receipt и pending не выдаются за ответ; prompts инструментов объясняют новый async-контракт.
Сохранённые старые tool-results с answer остаются читаемыми legacy-данными, не переисполняются.

Новый SubAgentParentCoordinator получает facade и host subscribeResults/listRunRefs;
методы beforeModelRound():Promise<readonly Exclude<SubAgentResultState,{state:«pending»}>[]>,
acknowledgeResults(results:readonly {ref:SubAgentRunRef;resultRevision:number}[]):void,
beforeFinalize(signal?:AbortSignal):Promise<«ready»|«resume-with-results»>.
На границе следующего model round он получает новые terminal states, включая ошибки,
и передаёт их как ограниченный служебный контекст с run IDs и доказательствами, не UI message.
Нельзя менять уже отправленный provider request или повторно выдавать tool-result для
callId, который уже получил receipt. Формат контекста корректен для конкретного provider
protocol; child output явно отделён как недоверенные данные, не system instructions.
Ack пары (runId,resultRevision) только после принятого round; повторная доставка того же ID после ошибки допустима,
но не повторяет импорт/запуск. Новая resultRevision после восстановления import
доставляется даже при прежней ошибке того же run; progress updates не доставляют результат снова. get_subagent_result идемпотентен, даже после автоматической доставки.
При отсутствии parent model round signal только будит ожидание, не запускает модель
на каждое child event и не создаёт параллельных parent iterators.

BeforeFinalize не допускает молчаливого уничтожения незавершённой делегированной работы.
Если есть pending children, final draft не публикуется как complete; parent ждёт сигнал
результата без новых model requests/polling. Готовые результаты дают resume-with-results
для следующего round, после обработки всех — ready. Parent/user stop по-прежнему может отменить детей. У ожидания есть нормативный предел
SubAgentParentCoordinator.maxFinalizeWaitMs (default 600000), общий на parent run и не перезапускаемый после
resume-with-results: по его исчерпании выполняется тот же closeAll, что при parent terminal, дети получают
terminalReason finalize-timeout, и ответ публикуется с notice interrupted; слот при этом занят до 10 минут,
это принятый риск; deadline проверяется
через runPastDeadline. Explicit model stop делает зависимость terminal.
Во время такого ожидания действует текущая политика top-level slot: parent остаётся running
и занимает один слот, дополнительных provider ресурсов parent нет. Приостановка ради
пользовательского согласования в будущем Deep Research регулируется его отдельным протоколом.

Перед доставкой SubAgentImportedEvidenceResolver и EvidenceRegistry.importRegisteredSnapshot
включают checked conversation aliases в текущий run registry. Финальный bind и проверка цитат
видят те же revisions без второго durable import. UI не показывает child ответ отдельно.
В Thinking доставленные run IDs живут в текущем invocation, crash прерывает parent как прежде;
будущий Deep Research хранит их в своём resumable checkpoint. Epoch fencing не отзывает
сессию ребёнка при возобновлении того же nonterminal parent.
Tool capabilities, source scopes/counts и telemetry сохраняются; момент/shape ответа launch
меняется намеренно. Direct и mapSources telemetry не смешиваются. До шага 9 legacy
stateless путь остаётся только у map_sources. Deep Research целиком пока не реализован.

## 3. В основном окне команды и уведомления

ChatSubAgentBridge принимает post-transition dispatch и notice intents, сериализует вместе с main
messages и сохраняет один stable eventKey/sequence. Фактический task виден безопасным
текстом в отдельной записи «Сообщение агенту» с description/ID связи и командой;
длинная команда сворачивается, но доступна целиком в пределах validated task limit.
Ретрай отображается как новая отправленная команда соответствующего run.
Acknowledgement accepted command включает durable dispatch либо bounded recovery marker.
Model/CoT и невыполненная из-за отказа команда не выдаются за отправленное сообщение.

Уведомления жизненного цикла (шаг 6) отображаются отдельными узлами timeline по макетам M6/M7:
карточка «Task sent to agent» с live-статусом из inspection snapshot (на reload без snapshot —
без статуса) и карточка результата с replyExcerpt и «Show full reply» внутри лимита 4 KiB.
Child phase/tools/progress/debug In/Out попадают только в child projection. Даже debug не
показывает их или вывод run_subagent в основном workflow, tool output viewer, fallback/legacy
rendering, diagnostic UI shortcut основного сообщения либо main export. Кнопка «Open details»
показывается только когда host передал onOpenSubAgentSession (шаг 10). Уведомления не
объявляются отдельной live region.
Диагностический отчёт может сохранять безопасные агрегированные counters без child payload.
Обычные tool calls родительского агента и его финальные ответы не скрываются.

Новый ChatTimelineItem строит единый parent порядок messages+dispatch+notices по sequence.
Старые messages получают sequence в прежнем порядке без изменения IDs/createdAt/source usages.
В SavedChat v4 добавляются optional subAgentDispatches/subAgentNotices/timelineSequence, validation всех
новых полей; старые v2/v3/v4 без них читаются без потери сообщений.
Обязательно обновить всю цепь чтения/записи:

- SavedChat и SaveChatInput в src/core/chat/savedChat.ts: новые optional поля;
  ChatDisplayMessage.timelineSequence хранится вместе с message, DTO берётся из core.
- parseSavedChat извлекает поля из untrusted rest, отдельно валидирует IDs/body/sequence;
  чужие/повторные/повреждённые события не попадают в projection без нормализации.
- createIdleSessionState и sessionStateFromSavedChat инициализируют/восстанавливают поля;
  legacy messages получают стабильные sequence в порядке массива при первом сохранении.
- ChatSessionManager.saveInput передаёт dispatches/allocator и message sequences, включая
  start-save, ordinary save, terminal save и persistDiagnostics=false.
- FileChatRepository.saveChat сохраняет новые поля в вручную собираемый SavedChat;
  отсутствующее поле input сохраняет existing значение, для нового чата — []/0.
  rename/favorite/unread/run-state update не обнуляют историю или allocator.
- ChatCompaction/stripMessageDiagnostics не удаляют chronological identity retained items.
  JSON-дубли eventKey объединяются идемпотентно, повреждённые события не расширяют права.
  Allocator после reload больше максимального сохранённого sequence; коллизия sequence
  разрешается детерминированно без перестановки старых message IDs/citation usages.
  Сохранённые nested run_subagent children/Out не удаляются, но parent display projection
  скрывает их, включая legacy branch. Их наличие не создаёт фиктивную history session в modal.
  Для такой legacy-сессии подробности недоступны, основной transcript сохраняет только
  восстанавливаемую отправленную task; при отсутствии task — безопасную метку без выдумок.

Display projection отделена от model history: новые dispatch и notice entries не отправляются модели
второй раз как user messages, не участвуют в token budget родительского chatHistory.
Не удалять реальные tool protocol messages, необходимые продолжающемуся вызову модели.
Старый emitNestedSubAgentEvent перестаёт отправлять nested events в parent stream;
события идут observation channel с полными session/run IDs.

## 4. Критерии и тесты

До изменения потока отредактировать существующие characterization cases:
tests/unit/sub-agent.test.ts, tests/unit/chat-session-runtime.test.ts,
tests/unit/chat-session-manager.test.ts, tests/unit/research-progress-reducers.test.ts.
Проверки прежней nested визуализации заменяются проверкой child observation и main dispatch.
Не добавлять дубли «старое событие скрыто» рядом со старым ожиданием «видно».
План роста +5 unit, +3 scenario (U3 разделён на три case: U3a barrier/без polling/потерянный сигнал/maxFinalizeWaitMs,
U3b success/failure/stop и bounded import failure будят один loop, U3c новая resultRevision и user cancellation); остальные случаи редактируются.

- U1 новый: delegator/grant передаётся runtime-owned service, active-file capture неизменен.
- U2 новый: parent projection всех current/legacy/debug веток удаляет child details,
  оставляя dispatch, notices и собственные parent tools; model history не содержит второй task и notices: fixture держит в state dispatches и notices, утверждение — на provider request, собранном из этого state, а не только на chatHistory.
- U3 новый: completion barrier не публикует final при pending children, без busy polling;
  сигнал между snapshot и подпиской не теряется; ожидание ограничено maxFinalizeWaitMs;
  child success/failure/stop, включая bounded import failure, будят один parent loop;
  новая resultRevision после repair доставляется повторно, user cancellation освобождает ожидание.
- S1: seam runtime↔fake child host: failed start-save/parent terminal (включая зависший save: слот освобождён
  после deadline)/suspend-resume/
  unload/delete сохраняют нормативный порядок, top-level queue не нарушена.
- S2: seam real session-backed tool↔fake model/registry: одинаковые callId в разных rounds дают разные run;
  receipt приходит до завершения child, parent выполняет независимый tool/round;
  затем committed result доставляется на безопасной границе с conversation aliases;
  source counts/telemetry не удваиваются, replay/idempotent getResult не повторяют работу.
- S3: seam saved chat reload↔real parent projection: chronological dispatch и notices idempotent;
  по одной строке на каждый вид notice проверяют заголовок, иконку и действие (M6/M7);
  старый v4 nested child payload не виден даже при debug и IDs citation usages сохранены.
  В этом же сценарии load→ordinary save→terminal save→reload с diagnostics=false,
  rename/favorite/unread/run-state update сохраняет dispatches/message sequence/allocator;
  новый dispatch получает следующий sequence. Проверять через реальный repository с fake FS,
  не только объект SavedChat без вызова saveChat; старый сохранённый результат run_subagent читается
  и не переисполняется, а model history и replay не отправляют его повторно.
  State transition, import/tombstone, capture и budget tests не дублировать.

Live L1: npm run build, открыть основной чат Obsidian с parallel/follow-up sub-agent,
проверить продолжение parent до результата, исходящие команды и уведомления без child tool calls в normal/debug и сохранение после reload;
empty/long command/error/narrow width, собственный parent workflow должен остаться.
Команды: npm run check; npm run test:growth -- origin/main. Дать наблюдение по экрану.

## 5. Отложено

До шага 9 map_sources workers выполняются прежним stateless путём и не входят в новый
inspection; до шага 10 пока нет пользовательской кнопки, но inspection port работает.
Это временные ограничения отдельных проверяемых шагов, не финальные исключения требований.
