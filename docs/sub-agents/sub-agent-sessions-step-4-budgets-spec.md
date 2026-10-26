# Шаг 4 — Required-scope budgets без вложенных serializers

Спецификация для нового budget-модуля src/application/use-cases/sub-agent/subAgentBudget.ts.
Deep Research ledger не реализуется: вводится mode-neutral порт и проверяется fake owner.

## 0. Контракт шага

Потребляет SubAgentSessionManager, SubAgentDelegator, SubAgentExecutionPort,
SubAgentSessionRepository из шагов 2–3 и SubAgentBudgetPolicy из шага 1.
Производит новый SubAgentBudgetPermitPort в src/application/ports/subAgent.ts:

```ts
interface SubAgentBudgetPermitPort {
  beginSessionRegistration(
    scopeId: string,
    creationKey: string,
  ): Promise<SubAgentBudgetRegistrationResult>;
  finishSessionRegistration(
    registration: SubAgentBudgetRegistration,
    outcome: { type: "published"; sessionId: string } | { type: "aborted" },
  ): Promise<SubAgentBudgetRegistrationFinishResult>;
  beginExecution(scopeId: string, actionKey: string): Promise<SubAgentBudgetReserveResult>;
  reserve(scopeId: string, request: SubAgentBudgetRequest): Promise<SubAgentBudgetReserveResult>;
  markStarted(permit: SubAgentBudgetPermit): Promise<void>;
  settle(permit: SubAgentBudgetPermit, outcome: "consumed" | "not-started"): Promise<void>;
  claimClosureCleanup(scopeId: string, closureId: string): Promise<boolean>;
}
```

Новые типы:

- SubAgentBudgetUnit = branchAttempts | modelRounds | searches | fetches | evidenceItems |
  verificationFollowUps | inputTokens | outputTokens.
- SubAgentBudgetRequest = {actionKey:string; action:«model-round»|«search»|«fetch»|«evidence-append»;
  units: Partial<Readonly<Record<SubAgentBudgetUnit,number>>>}.
- SubAgentBudgetPermit = {permitId,scopeId,actionKey:string}.
- SubAgentBudgetRegistration = {registrationId,scopeId,creationKey:string; generation:number}.
- SubAgentBudgetRegistrationResult = registered с registration либо denied с closureId,
  creationKey, closedAt и reason: exhausted с dimension:SubAgentBudgetUnit либо deadline.
- SubAgentBudgetRegistrationFinishResult = accepted либо closed с closureId,closedAt,reason.
- SubAgentBudgetReserveResult = granted с permit; либо work-denied с denialId,actionKey,
  reason=per-work-attempt-limit; либо denied с closureId,actionKey,closedAt,reason.

SubAgentPendingAction (новый payload шага 2) хранит actionKey, sessionId, runId, attempt,
action, ordinal, fenceGeneration, state: prepared|reserved|started|settled|unknown,
permit и outcome при наличии. При port exception — явный budget-port-error, не local fallback.
Производит новый SubAgentBudgetCoordinator, расширяющий manager required-scope protocol.

## 1. Регистрация и неизменность scope

Grant runtime связывает scope с тем же chat/parent binding и optional opaque work
binding; manager не читает ledger Deep Research. Model не выбирает local для обхода scope.
Follow-up/retry/partial наследуют immutable policy и maximum source policy.
Два scope одного parent сохраняют разных owners, нельзя подменить scope строкой команды.

Create required-scope:

1. В manager transition persist private pending create и stable candidate/creation key.
2. Off-lock beginSessionRegistration регистрирует in-flight операцию открытого поколения.
3. В manager transition CAS binding/fence, persist published либо abort intent.
4. Off-lock finishSessionRegistration(published|aborted), затем final delivery check.
   Create result доступен только после accepted finish; closed не возвращает usable session.

Scope closure запечатывает generation; post-seal begin возвращает stable denial.
Pre-seal registration обязана finish даже при cancellation/ошибке/смене epoch.
Published во время sealing session включается в cleanup enumeration и не доставляется.
Pending registration живёт в recovery metadata; зависший порт не удерживает manager lock.
Будущий Deep Research не имеет права начинать verify до durable zero in-flight registrations.
Эта обязанность проверяется contract-тестом fake owner, а не реализацией режима.

## 2. Execution permits и metering

Scheduler перед queued→running вызывает beginExecution со stable run/attempt action key.
Grant нужен до model/controller/iterator allocation. Execution permit считает одну попытку,
а не каждый model round. Отказ до side effect возвращает permit как not-started и owner
восстанавливает schedulable work atomically. Work denial затрагивает только связанный work.

Каждое метерируемое действие: reserve → durable markStarted → side effect → settle.
Action key = стабильная комбинация session/run/attempt/action/ordinal, ordinal отдельный
для action внутри run/attempt и сохраняется в pending action; глобальный счётчик запрещён.
Execution использует ordinal=0. Повтор reserve возвращает тот же single-use permit.
Evidence side effect — durable registry append, не предварительная подготовка.
MarkStarted идемпотентен и выполняется непосредственно перед контактом.
Started или неопределённый результат всегда consumed; not-started допустим только до start.
Settlement в finally на success/error/abort/stale delivery; recovery использует тот же key. settle в
SubAgentBudgetPermitPort идемпотентен по permitId, побеждает первый результат: повторный settle(consumed) после
settle(not-started) ничего не списывает.
Нет state=completed в getResult при unresolved settlement; queued receipt этого не означает. Неизвестные/NaN/отрицательные units — ошибка.

Трёхфазная операция для каждого метода budget:

- persist pending identity/fence в manager transition, отпустить serializer;
- await port только под его ledger serializer;
- CAS всей identity в manager transition; затем off-lock необходимый settlement.
  После успешного CAS идёт await durable markStarted, затем второй CAS identity и fence, и только после него
  side effect без await. Stop после durable start даёт consumed без исполнения.
  При проигранном CAS не связываться с provider, поздний grant settle not-started;
  если start уже durable — consumed без исполнения. Никакой budget callback не re-enters manager.
  Stop/close fences синхронно даже при навсегда pending budget promise.

## 3. Denial и cleanup

Global denied содержит один durable closureId/reason/time для всех concurrent и поздних
отказов и отдельный actionKey запроса. Cleanup claim — compare-and-set, один owner.
Notice публикуется после выхода manager transition. Claim/cleanup никогда не держат ledger
или manager lock при вызове другого manager. Cleanup останавливает все сессии scope,
завершает их результат ожидания и публикует terminal states, снимает queued entries, не затрагивает соседний scope.

Любой non-grant execution результата persist queued→failed, очищает active ID и queue,
не выделяет ресурсы и публикует terminal failure для уже выданного receipt; ранее подтверждённый приём
не превращается в отказ приёма задним числом. Port-error хранит unresolved key,
bounded recovery ищет прежний permit; late grant после stop не возобновляет работу.
Work-denied идемпотентен по actionKey, хранит denialId и не создаёт global closure notice.
Local policy не требует scope port, но сохраняет собственные hard limits.
Required token limits допустимы только при проверяемом bound входа/выхода до запроса;
при невозможности owner отклоняет действие явно, не считает unknown usage нулём.
Фактическая provider usage сохраняется отдельно от reservations/консервативных estimates.

## 4. Критерии и тесты

Новые tests/unit/sub-agent-budget-protocol.test.ts; +10 unit, +1 scenario в tests/scenario/sub-agent-budget-ledger.test.ts.

- U1: trusted policy/foreign scope, два owners, запрет spoof callerMode/local.
- U2: registration pending replay и create digest, без повторной allocation.
- U3: seal против pre-/post-seal begin; finish published/aborted и zero barrier.
- U4: execution permit ровно один на run, metering keys стабильны после reload.
- U5: reserve/start/CAS/settle порядок; сбой start не вызывает provider.
- U6: cancel до start/после start и ambiguous result правильно расходуют permit; replay settle(consumed) после
  settle(not-started) через reload ничего не списывает.
- U7: work-denied replay не закрывает соседний work или scope.
- U8: concurrent global denial даёт один closure/cleanup owner и terminal result для ранее подтверждённых run receipts.
- U9: каждая budget promise может зависнуть, но stop/close fences и bounded recovery работают;
  поздний grant после dispose получает settle not-started, число неоформленных в SubAgentCloseResult.
- U10: неизвестные units и port rejection явны; не появляется local bypass.
- S1: seam manager↔fake ledger с конкурирующими create/start/closure; no nested-await
  проверяется управляемыми gates, а не asserts приватной структуры lock.
  Тесты uses fake ports и settle, не sleeps; deadline из шага 3 повторно не тестируется.
  Удалённые state keys и observer maps не остаются после удаления чата.

Команды: npm test -- --run tests/unit/sub-agent-budget-protocol.test.ts;
npm run check. Production stateless path ещё не переключён.

## 5. Отложено

Реализация конкретного Deep Research scope/ledger — за пределами комплекта.
Метрика реального evidence append и provider usage подключается шагами 5–6.
