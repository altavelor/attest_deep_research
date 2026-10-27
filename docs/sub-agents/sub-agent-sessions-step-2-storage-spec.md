# Шаг 2 — Хранение и восстановление дочерних сессий

Все предложенные child-модули новые. Существующие SavedChat/parseSavedChat находятся
в src/core/chat/savedChat.ts, ChatRepository — в src/application/ports/chat.ts,
FileChatRepository — в src/adapters/filesystem/FileChatRepository.ts.
Состояние дочерних сессий хранится в том же файле чата и пишется тем же буфером,
что и сам чат; отдельных файлов и отдельного writer у дочерних сессий нет.

## 0. Контракт шага

Потребляет SubAgentSessionSummary, SubAgentRunSummary, SubAgentSessionRecord,
SubAgentCreateRecord, SubAgentSubmissionRecord, ParentRunBinding, NormalizedUsage из шага 1.

Расширяет существующий ChatRepository методами
loadChatDocument(id: string): Promise<{ chat: SavedChat; base: ChatFileBaseline } | null> и
commitChatDocument(change: ChatDocumentChange): Promise<ChatDocumentCommit>.
Новый ChatFileBaseline — непрозрачный токен содержимого файла, прочитанного или записанного
держателем: текст содержательной части (messages, lastAnswer, attachedContextPaths, chatSettings,
sourceRegistry, а с шага 8 также subAgentDispatches, subAgentNotices, timelineSequence; пустое
значение и отсутствие поля равны) и текст секции subAgents. Метаданные (title, isFavorite, unreadCompletion, lastRun,
updatedAt) в токен не входят.
Новый ChatDocumentChange = { chatId: string | null; base?: ChatFileBaseline; chat?: SaveChatInput;
subAgents?: SubAgentStateSnapshot }; chatId=null допустим только вместе с chat, без base, и
создаёт durable ID; любой другой commit без base отвергается как ошибка программирования.
Новый ChatDocumentCommit = { chat: SavedChat; base: ChatFileBaseline; subAgentRevision: number | null;
written: boolean }; written=false — содержимое на диске уже совпадало.
Новый ChatStorageError = { code:«unreadable-section»|«invalid-snapshot»|«document-conflict»|
«chat-missing»|«file-too-large»; message: string } — единственный тип ошибок хранения этого шага.
Правило отсутствия файла одно: chatId≠null и файла нет — ChatStorageError chat-missing, и ничего
не создаётся, независимо от наличия chat-части; создаёт файл только chatId=null.
Операция выполняется внутри существующей очереди мутаций файла чата: читает файл,
заменяет только переданные секции, сохраняет остальные поля без изменений и пишет
temp+atomic replace. Расширяет также FileSystemPort методом removeReplaceable(path): Promise<void> —
удаляет файл вместе со служебными копиями замены (VaultFileSystem сначала убирает резервное имя,
затем файл и не обращается к основному пути между шагами), чтобы репозиторий не знал суффикса.
Слой, вызывающий create/run дочернего агента, переводит коды хранения
в SubAgentSessionError persistence-failed с details {storageCode}; ChatStorageError наружу
через SubAgentDelegator не выходит.

Расширяет SavedChat optional полем subAgents?: SavedChatSubAgents.
Новый SavedChatSubAgents = {status:«ready»; snapshot: SubAgentStateSnapshot}
| {status:«unreadable»; raw: ValidatedJsonValue; reason: string}.
Новая чистая parseSavedChatSubAgents (core/chat/savedChat.ts) проверяет секцию отдельно
от остального чата; validateSubAgentState (core/research/subAgent/) проверяет её содержимое.
Новая чистая recoverSubAgentState(snapshot, completedAt) (core/research/subAgent/recovery.ts)
(Сессия хранит optional resources и maxSearches; валидация требует их в границах шага 1,
session.chatSessionId = chatId и session.parentRunId = parentRunId новейшего run.)
переводит nonterminal run в interrupted/crash-recovery, сессию с прерванной работой — в
interrupted (бездействующая сохраняет статус, archived не ставится), и сессии продолжаемы
следующим родительским запуском чата,
добавляя pending import в cancelledImports и не создавая binding; её использует startup recovery (раздел 3).
Все типы секции — core: SubAgentStateSnapshot и всё, что в него входит, включая
MapSourcesBatchRecord (шаг 9), лежат в core и не импортируют application.

Новый SubAgentStateSnapshot = { version: 1; chatId: string; revision: number;
records: readonly SubAgentSessionRecord[]; creates: readonly SubAgentCreateRecord[];
submissions: readonly SubAgentSubmissionRecord[];
imports: readonly SubAgentImportRecord[]; pendingActions: readonly SubAgentPendingAction[];
recoveryMarkers: readonly SubAgentRecoveryMarker[]; observation: readonly SubAgentObservationRecord[] }.
Новые SubAgentImportRecord/SubAgentPendingAction/SubAgentObservationRecord — расширяемые
валидируемые discriminated записи; их payload окончательно определяют шаги 4–6.
До подключения расширения неизвестный discriminant отклоняется, не интерпретируется.
Новый SubAgentRecoveryMarker содержит parentRunId, terminalReason, createdAt,
fencedRunIds, cancelledImports: {importId,generation}[], unresolvedActionKeys: string[].

Новый SubAgentSessionRepository (только чтение): load(chatId: string):
Promise<SubAgentStateSnapshot | null>. Реализует новый ChatDocumentSubAgentRepository
(src/adapters/filesystem/sub-agent/) поверх ChatRepository.loadChat; секция unreadable
даёт ChatStorageError unreadable-section, отсутствие секции — null. Методов save/remove нет:
пишет только ChatWriteBuffer (и startup recovery через commitChatDocument), удаляет только deleteChat.
Порт размещается в новом src/application/ports/subAgent.ts и не импортирует адаптер.

Новый SubAgentDurableWriter — самостоятельный интерфейс в src/application/ports/subAgent.ts:
markDirty(key:string, revision:number, payload:SubAgentBufferedValue):«accepted»|«full» и
flushThrough(revision:number, reason:SubAgentFlushReason):Promise<void>. Это узкий порт
для manager, import, budget и map_sources; порт не импортирует use case.

Производит новый ChatWriteBuffer в application/use-cases/chat/, реализующий SubAgentDurableWriter и
добавляющий markChatDirty(input:SaveChatInput):number — возвращает revision, которую должен
подтвердить flush, discard():Promise<void> — обратимый fence для удаления: отвергает новые записи,
ждёт запись в полёте, отклоняет ожидающие flushThrough ошибкой chat-missing, а накопленные deltas
сохраняет в памяти, reopen():void — снимает fence после неудачного удаления,
resolveConflict(choice:«reload»|«keep»):Promise<void>, dispose():Promise<void>.
Конструктор получает ChatRepository, getChatId():string|null, onChatBound(id:string), загруженную
базу SubAgentStateSnapshot и ChatFileBaseline (null до первого сохранения нового чата), now(), планировщик таймера и limits:{detailsBudget:number;
fileGuardChars:number} (defaults 2 MiB и 20 Mi символов); ничего не импортирует из адаптеров.
Буфер создаётся в конструкторе ChatSessionRuntime, до появления chatId, и освобождается вместе
с runtime. До привязки chatId markDirty дочерних deltas бросает ошибку программирования (assert), которая не
переводится в пользовательскую ошибку: durable chatId существует до child create по шагу 8.
Новый SubAgentBufferedValue — валидированная delta, не полный снимок:
{op:«set»;entity:«session»|«run»|«create»|«submission»|«import»|«action»|«observation»|«batch»|«marker»;
id:string;fields:Readonly<Record<string,ValidatedJsonValue>>} либо {op:«delete»;entity;id:string}.
Новый ValidatedJsonValue — проверенное JSON-значение; fields — allow-listed поля одной entity,
не массив всей истории/всех runs. Keys/paths выводит host, модель не задаёт операции записи.
SubAgentFlushReason = timer|size|count|barrier|dispose.

## 1. Решение

Один файл на чат: <настроенная папка сохранённых чатов>/<chatId>.json. Его путь не меняется.
Состояние дочерних сессий — optional поле subAgents той же schema v4; версия не повышается:
parseSavedChat принимает только 2, 3 и 4, поэтому v5 сделала бы чат нечитаемым при откате плагина.
Чаты v2/v3/v4 без subAgents читаются как раньше; отсутствие секции означает пустое состояние.
Формат файла: компактный JSON без отступов и один завершающий перевод строки для всех файлов
чатов; файлы не предназначены для чтения человеком. Ранее записанные файлы с отступами
читаются как раньше и становятся компактными при следующем сохранении, отдельной миграции нет.
Верхнеуровневый ChainItem любого вида (tool-call, reasoning, checkpoint) может хранить optional timelineSequence (шаг 8). Поле
необязательное, schemaVersion не меняется: старые чаты читаются без него. При загрузке
normalizeSubAgentTimeline удаляет значение, не являющееся неотрицательным safe integer, и
поднимает allocator выше всех сохранённых sequence цепочек.
Порядок полей фиксирован: schemaVersion, остальные поля SavedChat, subAgents последним.
Путь строит адаптер из проверенного ID через isSafeChatId; task, title, model и resources
в путь не попадают, дочерние ID проверяются валидатором и не допускают traversal.

Запись: все прямые repository.saveChat из ChatSessionManager (run-start в beginRun,
persistSession, прерывание при выгрузке плагина) заменяются на markChatDirty(input) +
flushThrough(barrier). input — тот же SaveChatInput, который сегодня формирует saveInput(state) с
переопределениями lastRun и unreadCompletion; ChatSessionManager сам решает, когда чат можно
сохранять (non-terminal состояние сохраняется только run-start, как сегодня). Снимок передаётся
ссылкой, не копируется и не входит в лимит ожидающих данных; более новый заменяет менее новый.
Первое сохранение нового чата идёт тем же путём с chatId=null: commit создаёт durable ID, буфер
вызывает onChatBound, и только после этого модель получает управление. Сбой такого commit не
повторяется в фоне: снимок отбрасывается, ошибка возвращается вызывающему (beginRun сообщает
started:false), так что файл позже не появляется. Одна запись содержит
и чат, и накопленные дочерние deltas.
Метаданные чата (renameChat, setChatFavorite, setChatUnreadCompletion, setChatRunState)
остаются прямыми вызовами репозитория, но идут через ту же очередь файла.
saveChat без subAgents и каждая из этих операций сохраняют существующую секцию subAgents
как есть, включая unreadable; регрессия проверяется тестом. Старый плагин после отката
теряет секцию при следующем сохранении чата — принятый риск, фиксируется в разделе Risks PR.

Commit применяет принятые deltas к immutable base, собирает полный snapshot секции и вызывает
commitChatDocument. revision секции защищает от перезаписи более нового snapshot старым
асинхронным save; commit с меньшей revision отвергается. При ошибке durable save
in-memory acknowledgement не выдаётся. Временный файл очищается при ошибке. Не добавлять dependencies.
Если секция unreadable, запись subAgents отклоняется ChatStorageError unreadable-section, а
chat-часть продолжает сохраняться без изменения секции.

## 2. Буфер записи

Нормативные defaults: 500 ms от первого несохранённого изменения, 128 принятых обновлений
или 64 KiB UTF-8 сериализованных ожидающих дочерних deltas; достижение любого порога запускает flush.
Таймер не debounce: новое событие не переносит срок первого dirty изменения.
Каждый save переписывает весь файл чата, поэтому не-barrier flush не начинается раньше чем через
2000 ms после завершения предыдущего save любого вида; barrier этому интервалу не подчиняется.
Повтор одного key заменяет payload более новой revision, сохраняя число принятых обновлений
для count trigger. In-memory read model и подписчики UI обновляются сразу.
В один момент только один save; изменения во время него остаются в следующем batch.
Success очищает только revisions, вошедшие в записанный batch, не более новые обновления.
flushThrough(R) ждёт durable revision >=R; ошибка save не подтверждает R и не теряет buffer.
Одновременные barrier обязаны объединяться: все ожидающие deltas и dirty chat уходят одной
записью, число записей не растёт с числом параллельных barrier. Ожидание остановки ограничено
текущим save в полёте плюс одним собственным.

Жёсткий лимит pending payload буфера — 256 KiB, без учёта chat-снимка и уже сохранённой истории.
markDirty возвращает full, если запись не помещается; caller вне manager/chat transition
ждёт flush и повторяет приём с проверкой fence. Void fire-and-forget накопление promises
не считается backpressure. Можно объединять последние значения одного ключа,
а необязательные debug payload можно отбросить только с явным truncated marker.
Одно обязательное событие сверх лимита rejected до принятия, не тихо теряется.
Повтор после I/O ошибки имеет bounded backoff; нет tight retry loop или бесконечного роста.
Ошибка хранения видна host/UI; она не превращает buffered состояние в durable.
Запись общая: сбой save останавливает и chat-часть, и дочерние deltas. Прежний файл остаётся
целым благодаря atomic replace; это принятая связь, а не независимые writers.

Без ожидания таймера выполняется barrier для create/submission queued до receipt,
права/отзыва/stop/tombstone, scheduler-start до внешней работы, runner terminal,
import prepare/registry commit/marker, budget reserve/markStarted/settle и recovery marker,
а также для каждого сохранения чата: run-start, terminal и прерывание при выгрузке.
Recovery marker (шаг 3 §4) имеет приоритет: он отменяет ещё не начатый ожидающий batch, а его deltas и
ожидающие flushThrough (drain, import commit, parent terminal) переходят в commit marker и завершаются вместе
с ним, а не отклоняются; запись в полёте отменить нельзя. Barrier сбрасывает нужную revision и
предшествующие изменения, но ни acknowledgement,
ни внешний side effect не опережают durable prerequisite.
Бюджетный ledger остаётся отдельным хранилищем вне файла чата и соблюдает ту же семантику.
Частые elapsed/phase/usage previews/tool deltas буферизуются; terminal сводка flush обязательна.
После crash допустима потеря только последних некритичных progress updates; не принятой
команды, запрета отмены, бюджета или объявленного завершённого результата.

Close/dispose снимает timer и пытается flush в общем deadline шага 3, не добавляет новый
неограниченный timeout. Удаление чата использует discard(): ChatSessionManager.deleteChat
вызывает его до repository.deleteChat, так что поздние записи не доходят до файла, а запись в
полёте дожидается. Успешное удаление завершает буфер через dispose(); при ошибке удаления host
вызывает reopen(), и буфер продолжает работу с сохранёнными deltas. Дочерний буфер не задерживает независимые сообщения родителя
дольше одной записи.

### 2.1 Эффективность записи

- Пропуск неизменённой записи. Собранный текст сравнивается с прочитанным текстом файла точным
  равенством, без хеша. При равенстве файл не пишется, commit возвращает written=false;
  acknowledgement выдаётся, потому что диск уже содержит запрошенное состояние, а baseline
  (раздел 2.2) принимает диск.
- Кэш сериализации секций. Адаптер держит для открытого файла тексты секций верхнего уровня,
  записанные или прочитанные последним commit. Секция вне change берётся из кэша без parse и
  stringify, если прочитанный файл равен кэшу и baseline из change точным сравнением; иначе файл разбирается целиком, кэш пересобирается.
  Переданная секция сериализуется один раз на объект: снимки неизменяемы, неизменённая секция
  сохраняет identity, изменённая — новый объект. Кэш не превышает размер файла и освобождается
  при dispose runtime и при удалении чата.

### 2.2 Целостность и безопасность записи

- Проверка до записи. Собранная секция subAgents проходит validateSubAgentState.
  Ошибка даёт ChatStorageError invalid-snapshot: ничего не пишется, deltas остаются в буфере,
  durable acknowledgement не выдаётся, ошибка видна host/UI; chat-часть сохраняется без изменения секции.
- Осиротевший temp. При открытии чата и перед commit файл <chatId>.json.tmp обрабатывается:
  если основной файл читается — tmp удаляется; если основной существует, но нечитаем — tmp
  проходит parseSavedChat и при успехе заменяет основной, иначе удаляется; если основного нет,
  tmp всегда удаляется и чат не воскресает. Acknowledgement выдаётся только после замены,
  поэтому подтверждённые данные не остаются только в tmp.
- Предыдущая версия. На сохранениях чата terminal и при прерывании при выгрузке перед заменой
  читаемый основной файл, чей текст отличается от нового, записывается как <chatId>.json.prev;
  одна генерация. Barrier дочерних deltas, recovery marker и сброс по таймеру .prev не пишут.
  Если основной файл существует, но нечитаем, loadChat берёт .prev, помечает результат
  recoveredFrom=«previous», host показывает сообщение, а новая работа дочерних агентов в этом
  чате запрещена до следующего успешного обычного save; основной файл перезаписывается только им.
  Файлы .tmp и .prev не оканчиваются на .json и не попадают в listChats.
- Удаление. deleteChat в той же очереди удаляет через FileSystemPort.removeReplaceable основной файл
  вместе со служебными копиями замены, затем .tmp и .prev; основной путь после этого не
  проверяется на существование. После удаления ничего из этого чата не остаётся ни на диске,
  ни в синхронизации.
- Внешние изменения. Конфликт определяет ChatFileBaseline, который передаёт держатель: буфер runtime
  получает его из loadChatDocument или предыдущего commit, normalizeStaleChats — из собственного
  loadChatDocument. Репозиторий не хранит baseline между вызовами, поэтому несколько экземпляров
  репозитория и освобождение кэша конфликтов не скрывают. Перед записью файл читается и сравнивается
  с base:
  - содержательная часть записывается, только если на диске она равна base;
  - секция subAgents записывается, только если на диске она равна base; если внешне изменена только
    содержательная часть, дочерние deltas применяются к свежему документу, а base содержательной
    части в возвращаемом токене остаётся прежним, так что следующая запись содержательной части
    даст конфликт;
  - метаданные (rename, favorite, unread, runState) в сравнении не участвуют и применяются к свежему
    документу всегда, в том числе пока открыт конфликт: Reload их сохраняет, поскольку они уже на
    диске.
    Нарушение даёт ChatStorageError document-conflict, файл не меняется. Внешним считается любой
    писатель: sync, второе окно, ручная правка, старая версия плагина. Счётчика ревизий документа нет:
    две копии с одинаковым номером неразличимы, сравнивается содержимое. Старый файл без секции
    subAgents ложного конфликта не даёт: сравниваются тексты, а не номера.
    При конфликте чата снимок остаётся в памяти и виден пользователю, не-barrier flush
    приостанавливаются, barrier завершаются ошибкой без durable acknowledgement. Host показывает
    два действия, которые вызывают resolveConflict: «Reload from disk» (loadChatDocument заменяет
    состояние и baseline, не применимые дочерние deltas отбрасываются явным сообщением) и
    «Keep this chat» (буфер принимает baseline текущего диска, следующий barrier пишет снимок поверх).
    До выбора содержательная часть и секция не пишутся.
- Замена существующего файла. Репозиторий использует только FileSystemPort.rename;
  VaultFileSystem.rename уже заменяет существующий файл через временное имя attest-replaced
  и восстанавливает его после прерывания. Отдельные remove+rename не добавляются; поведение
  закрепляется тестом на fake filesystem, отвергающей rename на существующий путь.
- Предохранитель размера. Если сериализованный документ достигает fileGuardChars (по умолчанию
  20 Mi символов), сначала вытесняются все подробности terminal-запусков (раздел 4), и только если
  размер всё ещё не ниже порога, новые create/run дочерних агентов отвергаются ChatStorageError
  file-too-large с понятным сообщением, захват новых diagnostics payload отключается (признак
  truncated по шагу 6); сохранение чата и завершение уже идущих run продолжаются.
  Время одной записи для чатов 1, 5 и 20 MiB измеряется в L1, в том числе на Mobile.

## 3. Совместимость и recovery

- Текущая schema v4 и чтение v2/v3/v4 остаются совместимыми; subAgents optional.
- Неизвестная версия или повреждённая секция subAgents читается как unreadable, не удаляется
  и не перезаписывается «пустым» snapshot; показывается recoverable error, новая работа
  дочерних агентов в этом чате запрещена до исправления. Сообщения чата остаются читаемыми.
- Повреждённые ID, статусы, ссылки, timestamps и неfinite/отрицательные usage/revision
  отвергаются без расширения прав. Повреждение child-данных не блокирует чтение main chat.
- Startup (normalizeStaleChats) работает без runtime и буфера: для чата с nonterminal lastRun он
  читает чат через loadChatDocument, применяет recoverSubAgentState и пишет чат и секцию одним
  commitChatDocument с base из этого чтения (внешняя запись между чтением и записью даёт
  document-conflict, и этот чат пропускается до следующего запуска); живой provider stream
  не восстанавливается. Эта запись — единственный
  путь вне буфера и считается barrier.
- Восстановление никогда не создаёт действующий parent binding из диска.
  Pending creates/imports/permits сохраняются для последующей сверки по стабильным ключам.
- Recovery marker сильнее запоздалого normal snapshot: fence/tombstone не исчезает после
  очередного сохранения. Интерпретация imports/budgets делегируется шагам 4–5.
- Секция загружается вместе с чатом через loadChat вне chat/manager serializer. Долгий load
  имеет bounded ожидание; поздно загруженная секция после parent close проходит terminal recovery.

## 4. Хранение подробностей

Срок хранения выровнен: все записи живут столько же, сколько чат, и удаляются только вместе
с ним. Нет ни 30-дневного, ни 7-дневного срока, ни фоновой очистки по времени.

- commands, итоговые summary/usage/lineage/citation provenance, redacted initial prompt,
  tool records и phase records — срок жизни чата;
- context summaries — последние три полных (ограничение по числу, не по времени); реализация держит одну
  скользящую contextSummary на сессию и resultSummary ≤1000 символов на запуск, что строже требуемого лимита;
- raw provider responses, token deltas и chain-of-thought никогда не сохраняются;
- временные downloads удаляются при terminal cleanup;
- при удалении чата удаляется файл вместе с секцией, late flush его не воскрешает.

Без срока рост ограничен размером. Подробности (initial prompts, args/results tool calls,
phase records и тексты answer строк завершённых batch map_sources) всех сессий чата занимают
не более detailsBudget (по умолчанию 2 MiB UTF-8 в сериализованном виде).
Проверка выполняется при формировании snapshot: если лимит превышен, подробности самых старых
terminal-запусков удаляются по одному, пока лимит не соблюдён; из удаляемых подробностей
сохраняются записи, на которые есть цитаты. Вместо остального остаётся
признак evicted с причиной «chat size limit», а не пустой якобы полный prompt/output.
Вытеснение детерминированно, не использует часы и не запускается отдельно от записи.
Никогда не вытесняются commands, summary, usage, lineage, citation-referenced evidence,
pending actions, recovery markers и подробности non-terminal сессий. Dispatch и notice записи не входят
в секцию subAgents: это top-level поля SavedChat шага 8, не вытесняются, не считаются в detailsBudget
(body ≤2000 символов, replyExcerpt ≤4 KiB) и учитываются только общим guard 20 Mi символов;
отдельного лимита числа записей нет, рост ограничен жизнью чата — принятый риск. Если вытеснять нечего (подробности есть только
у non-terminal сессий), новые payload получают признак truncated по шагу 6, а запись продолжается.
При выключении диагностического сохранения summary и ссылки остаются доступны.
Наличие секции subAgents не должно принудительно сохранять никогда не использовавшийся draft.

## 5. Критерии и тесты

Новые tests/unit/sub-agent-state.test.ts, tests/unit/chat-write-buffer.test.ts с fake clock
и tests/scenario/chat-document-repository.test.ts. Ожидаемый рост: +18 unit, +8 scenario, не
считая правки существующего chat-store.test.ts (U1). Коммит, добавляющий более 15 cases, содержит
строку Case growth: в сообщении; реализацию шага рекомендуется делить на два коммита:
репозиторий и целостность — U2–U3, U15–U19, S1, S3–S8 (14 cases); буфер — U4–U14, S2 (12 cases).
Пороги лимитов — параметры конструктора: тесты границ используют малые значения, дефолты
проверяются один раз; ни один unit case не сериализует документ реального размера.

- U1: чаты v2/v3/v4 без subAgents и v4 с валидной секцией читаются; изменить существующий
  tests/unit/chat-store.test.ts, не дублируя кейсы версий.
- U2: corrupt/unknown секция даёт unreadable, сообщения чата читаются, raw сохраняется при
  следующей записи; validator failure codes проверяются вместе с message text.
- U3: recoverSubAgentState: nonterminal run становится interrupted, сессия архивируется,
  binding не создаётся; терминальные записи не меняются.
- U4: подробности ровно на границе detailsBudget не вытесняются; U5: сверх границы удаляются
  самые старые terminal-запуски, commands, cited evidence, pending и non-terminal остаются.
  Часы не используются.
- U6: tombstone и более новая revision секции побеждают late snapshot; discard() отвергает
  новые записи, включая barrier с chat-частью, ждёт запись в полёте, отклоняет ожидающие
  flushThrough ошибкой chat-missing (обещание не зависает), а reopen() возвращает буфер в работу.
- U7: до 500 ms flush нет, при достижении есть, новые updates не отодвигают дедлайн;
  U8: второй не-barrier flush ждёт 2000 ms после предыдущего, barrier не ждёт.
- U9/U10: bytes ниже 64 KiB / на границе; U11/U12: updates ниже 128 / на границе.
- U13: save in-flight + новое изменение + ошибка и повтор не теряют более новую revision.
- U14: barrier немедленно flush и не выдаёт durable ack при ошибке; dispose чистит timer;
  marker отменяет ещё не начатый batch, а ожидающие flushThrough завершаются вместе с commit marker.
- U15: собранный снимок до записи: invalid-snapshot не пишется и не подтверждается
  (failure code вместе с message).
- U16: размер на границе fileGuardChars: сначала вытеснение подробностей, затем file-too-large
  блокирует create, но не сохранение чата.
- U17: неизменённый текст не пишется (written=false, ack выдан); изменение одного поля пишет;
  документ компактный, без отступов, порядок полей фиксирован.
- U18: кэш секций наблюдаем результатом: после записи изменения одной секции байты остальных
  равны полной пересборке, а внешне изменённый файл той же длины с другим содержимым разбирается
  заново и не отдаёт устаревшую секцию.
- U19: backpressure: full при заполненном лимите, разбор после flush, история и chat-снимок
  свыше 256 KiB не мешают принять маленькую delta и terminal barrier; параллельные barrier
  объединяются в одну запись.
- S1: seam repository↔fake filesystem: atomic replace/error cleanup/повтор save; fake отвергает
  rename на существующий путь и прерывает его между шагами — файл не теряется;
  saveChat, renameChat, setChatFavorite, setChatUnreadCompletion и setChatRunState сохраняют
  секцию subAgents. Один сценарий fault→recovery, без реального диска.
- S2: seam буфер↔repository: chat barrier и дочерние deltas уходят одной записью;
  устаревшая revision отвергается; unreadable секция не перезаписывается, chat-часть пишется.
- S3: seam delete chat↔буфер: deleteChat удаляет файл, служебные копии замены, .tmp и .prev; fake
  filesystem моделирует восстановление резервного имени при exists основного пути, и удалённый чат
  не воскресает; барьер с chat-частью после удаления даёт chat-missing и не создаёт файл; при ошибке
  удаления ошибка показана явно, reopen() возвращает буфер и следующий barrier пишет.
- S4: recovery файлов: остаток .tmp при читаемом основном удаляется; при существующем нечитаемом
  основном валидный .tmp его заменяет, а иначе loadChat берёт .prev с признаком recoveredFrom
  и запрет новой работы агентов; при отсутствующем основном .tmp и .prev не воскрешают чат;
  .tmp/.prev не в listChats.
- S5: внешний писатель: внешняя правка → собственная metadata-операция → chat barrier даёт
  document-conflict (metadata-операция при открытом конфликте проходит, Reload её сохраняет);
  commit без base, кроме создания, отвергается; commit с base из чужого экземпляра репозитория
  тоже видит внешнюю запись; тот же размер и другое содержимое тоже даёт конфликт; sub-agent-only change
  применяется при внешней правке только chat-части, а следующий chat barrier после этого даёт
  конфликт; «Keep this chat» и «Reload from disk» снимают конфликт; старый файл без baseline
  ложного конфликта не даёт; после конфликта barrier падает без ack, flush по таймеру стоит.
- S6: .prev создаётся только на terminal-сохранениях и при выгрузке, содержит предыдущий
  читаемый текст и не создаётся barrier дочерних deltas и recovery marker.
- S7: startup recovery: normalizeStaleChats меняет файл — nonterminal run в секции стал
  interrupted, чат и секция записаны одним commit.
- S8: первое сохранение нового чата через буфер с chatId=null: созданный файл содержит вопрос и
  lastRun queued/running, onChatBound вызван, затем модель получает управление; при сбое создания
  файл не появляется и после продвижения fake clock, повторных commit нет.
  Валидаторы путей и секции тестируются U2 вместе с failure code/message; не дублировать в S1.
  Дата и время инъецируются; реальное ожидание в тестах запрещено.
