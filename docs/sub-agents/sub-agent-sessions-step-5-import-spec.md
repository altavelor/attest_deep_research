# Шаг 5 — Доказательства, cancellation tombstones и доставка

Спецификация. Существующие реестры — src/application/sources/evidence.ts и
src/core/chat/sourceRegistry.ts; сохраняется различие tool provenance и content revision.

## 0. Контракт шага

Потребляет SubAgentDelegator, SubAgentEvidenceImportPort, SubAgentImportRequest,
SubAgentImportResult, SubAgentExecutionResult из шага 3; ImportedSubAgentRunOutcome,
ImportedSubAgentEvidenceReference, SubAgentResultState, ParentRunBinding, ParentRunDeliveryContext из шага 1;
SubAgentSessionRepository из шага 2; SubAgentBudgetPermitPort из шага 4.
Производит новые SubAgentImportCoordinator и ChatSubAgentEvidenceBridge,
реализующие SubAgentEvidenceImportPort. Новые модули в application/use-cases/sub-agent/
и application/use-cases/chat/; bridge получает функции сохранения, не импортирует адаптер.
Производит нормативный SubAgentImportRecord (payload envelope шага 2):
importId,chatId,sessionId,runId,evidenceDigest:string; generation:number;
state: prepared|committed|tombstoned; evidence: readonly импортируемые элементы;
aliases: readonly ImportedSubAgentEvidenceReference[]; answerText:string;
createdAt:string. Tombstone сохраняет причину и поколение.
Производит recovery реализацию getResult(sessionId: string, runId: string):
Promise<SubAgentResultState> в SubAgentDelegator; receipt от этого не зависит.

Производит новый SubAgentImportedEvidenceResolver с методом
resolve(outcome: ImportedSubAgentRunOutcome): Promise<ResearchEvidenceSnapshot>.
ResearchEvidenceSnapshot — существующий тип src/application/sources/evidence.ts.
Resolver — внутренний scoped порт, проверяет committed import/binding; не доступен модели/UI.
ChatSubAgentEvidenceBridge реализует его по conversation registry, возвращает только checked
снимок с conversationEvidenceId в chunk/citation IDs и сохранённым provenance.
Производит новый EvidenceRegistry.importRegisteredSnapshot(snapshot: ResearchEvidenceSnapshot):void
в существующем application/sources/evidence.ts и его реализацию в существующем
src/adapters/research-tools/ResearchEvidenceRegistry.ts: aliases принимаются только из resolver,
существующие canonical handles не меняются, дополнительный durable import не выполняется.
Канонический source может иметь несколько разрешимых alias IDs; все ведут на ту же revision.

## 1. Два реестра и public outcome

ResearchEvidenceRegistry deduplicates web по canonical URL и хранит provenance вызовов;
ConversationSourceRegistry хранит source/revision и usages. Same source/content получает
ту же revision, изменённый content — новую superseding revision; provenance не теряется.
Child evidence несёт child ID/session/run/attempt/collectedAt/incomplete.
Родитель получает conversation IDs, а не локальные handles ребёнка.

Перед getResult(state=completed) зарегистрировать evidence в ChatSessionState.sourceRegistry,
переписать answerText и все citation-bearing поля DTO на conversation aliases.
resultSummary обязан быть citation-free либо тоже переписан; validation всего публичного
DTO не допускает unresolved child citations. Перед проверкой alias-набора элементы, отброшенные политикой ниже (недопущенный host, сверх лимита, неизвестный
provenance, WebResultCapacityError родителя), удаляются из evidence, а их citation-токены вырезаются из
answerText и всех citation-bearing полей, как делает текущий SubAgentTool; ответ доставляется, а
признак evidenceBudgetExhausted сохраняет прежнюю семантику. Проверка ёмкости родителя выполняется на prepare,
importRegisteredSnapshot на ёмкости не бросает. Только отсутствие alias у допущенного элемента даёт
import-failed: outcome не доставляется, prepared result остаётся внутри manager.
Переписанные answerText и resultSummary могут ссылаться лишь на alias-набор этого importId; любой иной
цитатоподобный токен (например, ID источника родителя) вырезается.
Во время running/importing наружу идут только безопасные observation metadata.

Web evidence сохраняет текущие проверки SubAgentTool: максимум десять items, разрешённое
search/fetch provenance и resource allow-list host; недопущенные элементы не маскируются
как подтверждённые цитаты. Index paths ограничены grant, ссылки не расширяют scope.

## 2. Prepare/commit без cross-repository transaction

1. Stable importId = chat/session/run + evidence digest, canonical сортировка source identity; флаг incomplete
   в digest не входит.
2. Manager transition проверяет safe successor lastImportGeneration, persist prepare (входит в тот же
   barrier, что runner terminal, чтобы import укладывался в 2000 ms при больших чатах),
   увеличивает last generation и pending generation, сохраняет deterministic evidence map.
3. Off-lock bridge под chat serializer регистрирует aliases/provenance keyed by importId
   и durable save sourceRegistry. Регистрация aliases только добавляет записи и не откатывается: на них
   уже могли сослаться цитаты родителя; при save failure они остаются, а orphan cleanup удаляет только
   не referenced aliases этого importId; буфер хранит неизменяемую копию реестра, а не ссылку на
   изменяемый; успешный durable save — логический import commit.
4. Manager transition CAS (chat/session/run/importId/generation), binding и tombstone,
   persist commit marker; ready/public delivery только после проверки epoch.

Последовательность никогда не держит manager lock во время await chat lock или наоборот.
Budget reserve/start/settle для evidence append также off-lock по шагу 4.
Synchronous fence предшествует возможному позднему callback; перед каждым durable write
перепроверяется полная identity. Tombstone выигрывает commit marker и repair.
Поздний registry save после tombstone может оставить только недоступные orphan aliases,
не public outcome; bounded cleanup удаляет лишь не referenced retained artifacts.
Generation никогда не сбрасывается/не используется повторно; значение выше Number.MAX_SAFE_INTEGER или
нецелое отвергает validateSubAgentState (core) и archive с checkpoint-corrupt. После import pending-поля очищаются, last generation остаётся.

## 3. Reconciliation и epochs

Startup/retry проверяет каждый prepare даже при наличии commit marker: tombstone запрещает
repair/lookup/delivery; иначе missing aliases восстанавливаются до доверия marker.
Interrupted run в importing не попадает; его evidence остаётся priorEvidence manager и импортируется только
при completion continue-partial run с incomplete=true, задаваемым на prepare. Старт нового run не использует чужой prepare.
getResult принимает retained committed run либо importing completed head той же
session и nonterminal parent binding. Committed возвращает completed, importing — pending;
Одна попытка import ограничена общим deadline 2000 ms; после ошибки/timeout публичный
result становится failed/import-failed, будит wait/parent и не содержит raw answer.
Prepared данные остаются для reconciliation. Startup recovery не может доставлять: после рестарта binding
terminal, поэтому он только ставит tombstone на pending import архивных сессий и выполняет orphan cleanup, без
repair aliases. Repair и commit выполняются в новом epoch при живом nonterminal binding и при
восстановлении repository; каждый проход — одна bounded попытка, не бесконечный retry loop.
Восстановление того же importId может дать completed с новой resultRevision; повторный lookup
сам по себе не создаёт новую попытку, исполнение или revision. Lookup не ждёт внешней работы.
resultRevision хранится с terminal publication metadata в секции subAgents, replay не увеличивает её.

bindingGeneration стабильна для одного nonterminal parent; deliveryEpoch >0 меняется
на suspend/resume. Facade захватывает epoch. Advance синхронно detach старые deliveries и
ожидания, завершает их fenced-delivery; уже подтверждённое исполнение и import могут
закончиться внутри manager независимо от старого вызова родителя.
New-epoch facade может вернуть тот же create/receipt/getResult; old epoch не меняет видимый main UI.
При parent terminal binding отозван: даже новый epoch не позволяет lookup с mutation.
Read-only historical inspection шага 6 не является facade lookup и работает после terminal.

## 4. Критерии и тесты

Новые tests/unit/sub-agent-import.test.ts и tests/scenario/sub-agent-import-bridge.test.ts.
План роста +9 unit, +1 scenario; существующий registry сам повторно не тестируется.

- U1: все citation-bearing поля outcome переписаны/отклонены, нет child handles.
- U2: prepare replay возвращает тот же importId/generation и не дублирует source.
- U3: tombstone побеждает committed marker и missing-alias repair.
- U4: monotonic generation после follow-up; MAX_SAFE_INTEGER+1 и corruption не обнуляют счётчик.
- U5: import failure сохраняет prepared head, getResult после bounded failure возвращает failed/import-failed,
  follow-up отклонён; reconciliation нового epoch даёт completed с новой resultRevision только после commit,
  не повторяя run.
- U6: old epoch не доставляет progress/create/outcome, new epoch retrieves same result.
- U7: parent close/stop/terminal во время registry save fences без deadlock и public outcome, pending import
  получает tombstone, repair архивной сессии не выполняется.
- U8: resource host/provenance и web import cap проверяются вместе с failure message;
  существующие import boundary cases tests/unit/sub-agent.test.ts редактируются/переносятся.
- U9: orphan cleanup сохраняет cited artifacts и не resurrects cancelled import.
- S1: seam real bridge↔fake ChatRepository: durable save failure→reconcile без отката, родитель
  параллельно зарегистрировал тот же источник и сослался на него — ссылка не повисает;
  registered source/revision aliases, без повторения чистых dedup tests.
  Сокращение старых import cases — только после трёх differential mutants на группу.

Команды: npm test -- --run tests/unit/sub-agent-import.test.ts
tests/scenario/sub-agent-import-bridge.test.ts; npm run check.
После шага новый manager способен полноценно работать через ports; production migration позже.

## 5. Отложено

Initial prompt и tool observation не передаются через evidence registry: отдельный канал
шага 6, чтобы debug payload не становился cited evidence или model history.
