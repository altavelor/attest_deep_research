# Шаг 9 — Асинхронные workers и результат map_sources

Спецификация для существующих src/application/use-cases/map-sources/MapSources.ts,
mapSourcesParse.ts, types.ts и src/adapters/research-tools/map-sources/MapSourcesTool.ts.
Сейчас MapSources.run ждёт все workers и возвращает matrix. Новый tool path возвращает
receipt batch; прежний matrix DTO сохраняется в отдельном запросе результата.

## 0. Контракт шага

Потребляет SubAgentDelegator, SubAgentWaitResult из шага 3;
SubAgentRunReceipt, SubAgentRunRef, SubAgentResultState из шага 1;
SubAgentImportedEvidenceResolver из шага 5; SubAgentInspectionPort/SubAgentObservationEvent
из шага 6 и SubAgentParentCoordinator из шага 8; SubAgentDurableWriter из шага 2.
Существующие MapSourcesInput, MapSourceRow, MapSourcesResult в application и buildSourceTask
сохраняют назначение. MapSourcesOutput существует в adapters/research-tools/map-sources/
MapSourcesTool.ts и не содержит snapshot. Перенести этот DTO, его MatrixRow и новый MapSourcesBatchRecord без смены shape в core
(core/research/mapSourcesOutput.ts, экспорт через core/research/index.ts): они входят в секцию
subAgents чата, а core не импортирует application. Application и adapter импортируют их из core,
обратный import запрещён. Это canonical wire matrix type.
Orchestration boundary становится асинхронной.
Производит новые типы и methods:

- MapSourcesBatchReceipt = {batchId:string;requested:number;refs:readonly SubAgentRunRef[]}.
- MapSourcesBatchState = {state:«pending»;batchId:string;completed:number;failed:number} |
  {state:«completed»;batchId:string;result:MapSourcesOutput} |
  {state:«failed»|«interrupted»;batchId:string;error:{code:string;message:string}} |
  {state:«failed»;batchId:string;error:{code:«unknown-batch»;message:string}}. Состояние preparing записи
  отображается как pending. Поиск по batchId ограничен чатом (manager одного runtime) и parent run, создавшим batch; чужой, прежнего
  parent run или неизвестный batchId даёт unknown-batch.
- MapSources.start(input:MapSourcesInput, requestId:string):Promise<MapSourcesBatchReceipt>;
  MapSources.getResult(batchId:string):Promise<MapSourcesBatchState>.
- MapSourcesWorkerPort.runSource(input:{requestId:string;task:string;sourcePath:string;
  maxRounds:number;maxResultChars:number;signal?:AbortSignal}):Promise<SubAgentRunReceipt>;
  getResult(ref:SubAgentRunRef):Promise<SubAgentResultState>.
- MapSourcesWorkerAdapter реализует этот порт, MapSourcesDeps.runner теперь имеет
  тип MapSourcesWorkerPort; его implementation находится в application, без adapter import.
- Новый model tool get_map_sources_result({batchId}) возвращает MapSourcesBatchState;
  map_sources возвращает {state:«accepted»;receipt:MapSourcesBatchReceipt}.

Новый MapSourcesBatchRecord хранит batchId,parentRunId,requestId,normalizedInputDigest,question,createdAt:string;
selection:«explicit»|«relevance»; sourcePaths:readonly string[];
refs:readonly {sourcePath:string;ref:SubAgentRunRef}[];
state:«preparing»|«pending»|«completed»|«failed»|«interrupted»;
result?:MapSourcesOutput; error?:{code:string;message:string}.
SubAgentStateSnapshot шага 2 расширен optional batches:readonly MapSourcesBatchRecord[];
отсутствие в уже сохранённой секции subAgents означает [], без переписывания старых данных.
Child origin=map_sources; раздельный manager/registry для batch запрещён.

## 1. Создание batch и запуск

Host requestId = stable parent map_sources call ID. Повтор start того же normalized input
возвращает тот же batch, иной digest — конфликт. Selection выполняется один раз, сохраняется.
До worker allocation durable batch intent; child requestId = batchId + canonical sourcePath,
не index массива/случайный ID. Частично выполненная регистрация восстанавливает недостающие
receipts идемпотентно, а не дублирует уже принятых workers.
Receipt возвращается после durable publication связей batch→child refs и очереди, не после
исполнения workers. Parent может сразу продолжить собственные инструменты/model rounds.
Отказ selection/пустой список остаются явными ошибками, не accepted пустого исследования.

Каждому документу — отдельная session/run с grant maximum indexOnly/одним sourcePath.
Note/web/active-file/mutation/recursion не передаются. Фактический retriever также ограничен:
prompt/indexSourcePaths сами по себе не защищают доступ через другие index tools.

Default selection — 8 документов, hard cap 20; shared manager cap=4 одновременно running;
perSourceRounds default 6, perSourceBudget input 2–12, maxResultChars=20000.
Direct children и workers используют общий FIFO, не создаётся второй конкурирующий limiter.
Child session count и scheduling concurrency различаются; top-level slots не расходуются.
source-start означает реальный scheduler-start, не receipt/queued; source-done — результат.

Валидированный direct task <=2000 остаётся границей SubAgentTool. Trusted buildSourceTask
из question<=1000/sourcePath<=500 допускается до 8192 символов только internal grant
origin=map_sources. Выжимка — chat naming policy, prompt/usage/model/lifetime доступны inspection.
Main показывает одну строку batch (шаг 6): MapSources при start создаёт, а при каждом worker-terminal upsert-ит notice
kind=batch через sink шага 8; отдельных dispatch и notices для workers нет, их internal calls/replies остаются в modal.

## 2. Получение matrix, отмена и статистика

Batch собирает terminal состояния по подписке manager, без model polling. Успешная строка
появляется только из completed ImportedSubAgentRunOutcome, не runner-completed/importing.
Resolver получает checked snapshot с conversation aliases; parent run evidence registry
при получении matrix использует importRegisteredSnapshot, без повторного durable import.
Ошибка строки остаётся строкой (`error?: string`, shape MapSourcesOutput не меняется) в виде «<код>: <redacted
текст>», не более 500 символов, а ошибка состояния batch — {code,message} с теми же ограничениями; оба формируются
до durable записи, сырой error.message провайдера не сохраняется и не показывается.
Evidence матрицы регистрируется под callId исходного вызова map_sources (requestId записи), поэтому
ссылки стабильны после reload; legacy-сохранённые чаты сохраняют прежнюю атрибуцию.
Shape готового MapSourcesOutput (question/rows/sourcePath/ok/stance/keyFindings/evidenceIds/
error/diagnostics) сохраняется. keyFindings/evidenceIds разрешимы и после reload.
MapSourceRow.snapshot остаётся обязательным у внутреннего MapSourcesResult, но отсутствует
в MapSourcesOutput и MapSourcesBatchState. Batch.result сохраняет только canonical wire
matrix и checked aliases; getResult после reload возвращает её без требования snapshot.
Если вызывается legacy internal run wrapper, его MapSourcesResult.rows[].snapshot
восстанавливается resolver из зарегистрированных evidence по refs, не из batch.result. Порядок rows равен сохранённой selection.

Один failed/user-stopped worker даёт failed row и не отменяет остальных; matrix сохраняет
частичный результат. Parent cancellation останавливает всех owned workers, queued не стартуют.
Global failure/interrupt batch явны, incomplete evidence не выдаётся за normal completion.
getResult pending не ждёт workers; completed result чтения идемпотентен.
Автоматическое уведомление parent о mapped workers содержит batch/ref/status без дублирования
полного row body; matrix забирается get_map_sources_result. Completion barrier шага 8 ждёт
их terminal состояние; необходимость учесть/объяснить failed rows сохраняется.
Matrix publication — write barrier; live счётчики batch можно буферизовать по шагу 2.

Diagnostic.mapSources остаётся отдельным массивом SubAgentTelemetry по реальным run IDs,
их не дублируют в direct aggregation. Ошибка до model request не выдумывает tokens/requests.
Parent finalization закрывает уже terminal сессии, пользовательский stop parent отменяет live.
Старый MapSources.run можно оставить внутренним compatibility wrapper start→wait→getResult,
но model tools не вызывают этот блокирующий путь. Готовая matrix — immutable snapshot;
позднее восстановление отдельного child import не переписывает её молча. Старые matrix tool-results в saved chats
читаются как legacy; новое async получение является намеренным изменением wire-контракта.

## 3. Критерии и тесты

Редактировать tests/unit/map-sources.test.ts, tests/unit/map-sources-tool.test.ts и
tests/unit/sub-agent-telemetry-summary.test.ts: запуск получает receipt до результатов,
получение matrix отдельно, old shape результата сохранён, состояния разных чатов не смешиваются.
План роста +2 unit, +1 scenario в tests/scenario/map-sources-async.test.ts; остальные cases заменяются без дублей.

- U1 новый: requestId/sourcePath стабильны, replay после частичной регистрации не множит runs.
- U2 новый: batchId прежнего parent run и чужого чата (общий store на два чата) даёт unknown-batch, секрет в ошибке worker не доходит до записи; batch receipt получен при заблокированных workers; pending getResult не ждёт;
  terminal matrix по selection order и idempotent чтение, user-stop одного даёт failed row.
- S1: seam real MapSources↔fake child manager/retriever и sink notices: batch notice создаётся один раз и
  обновляется на месте счётчиками, workers без notices; parent продолжает работу после
  receipt, shared cap=4 с direct children, row aliases разрешимы без повторного импорта,
  scope не расширен, ошибки не отменяют соседний worker.
  Budget/source/manager rules повторно не тестируются. Wait tests используют gates/подписки,
  не sleeps или actual provider. Старые merged/deleted cases — три differential mutants на группу.

Live L1: npm run build; запустить map_sources по нескольким заметкам в Obsidian и продолжить
независимый parent поиск до matrix. Проверить одну строку batch в main, inspection running
count и итоговую matrix через отдельное получение; никаких фиксированных model wordings.
Команды: npm test -- --run tests/unit/map-sources.test.ts tests/unit/map-sources-tool.test.ts;
npm run check. Проверить сохранение partial matrix и distinct safe telemetry.

## 4. Отложено

UI запуск/продолжение workers, рекурсия и глобальный resource governor вне задачи.
Подключение modal шага 10 использует те же данные origins direct/map_sources.
