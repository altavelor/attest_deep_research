# UML: права, хранение и бюджет

Источник: шаги 2–5. Схема показывает объекты протокола и их связи; все nodes новые,
кроме явно отмеченного контекста provider/model. Поля optional/null сокращены для читаемости.

```mermaid
classDiagram
  direction LR
  class SubAgentSessionManagerContext {
    <<DTO>>
    +getChatId()
    +getCurrentParentBinding()
    +getCurrentDeliveryEpoch()
    +resolveGrant(id)
    +now()
    +createId(prefix)
  }
  class ParentRunBinding {
    <<DTO>>
    +chatSessionId string
    +parentRunId string
    +bindingGeneration number
  }
  class ParentRunDeliveryContext {
    <<DTO>>
    +deliveryEpoch number
    +grantId string
  }
  class SubAgentDelegationGrant {
    <<DTO>>
    +binding ParentRunBinding
    +callerMode string
    +capturedActiveFilePath string
    +origin
    +limits
  }
  class SubAgentCreateRecord {
    <<DTO>>
    +createRequestId string
    +normalizedInputDigest string
    +status
    +candidateSessionId string
    +publishedSessionId string
  }
  class SubAgentStateSnapshot {
    <<DTO>>
    +version 1
    +chatId string
    +revision number
  }
  class SubAgentSessionRecord {
    <<DTO>>
  }
  class SubAgentSubmissionRecord {
    <<DTO>>
  }
  class SubAgentImportRecord {
    <<DTO>>
    +importId string
    +runId string
    +generation number
    +state
    +evidence
    +aliases
    +answerText string
  }
  class SubAgentObservationRecord {
    <<union>>
  }
  class SubAgentRecoveryMarker {
    <<DTO>>
    +parentRunId string
    +fencedRunIds string[]
    +cancelledImports
    +unresolvedActionKeys string[]
  }
  class SubAgentBufferedValue {
    <<union>>
    +op set_or_delete
    +entity
    +id string
    +fields
  }
  class ValidatedJsonValue {
    <<union>>
  }
  class SubAgentFlushReason {
    <<enum>>
    timer
    size
    count
    barrier
    dispose
  }
  class SubAgentPendingAction {
    <<DTO>>
    +actionKey string
    +runId string
    +attempt number
    +ordinal number
    +fenceGeneration number
    +state
  }
  class SubAgentBudgetRequest {
    <<DTO>>
    +actionKey string
    +action
    +units
  }
  class SubAgentBudgetUnit {
    <<enum>>
    branchAttempts
    modelRounds
    searches
    fetches
    evidenceItems
    verificationFollowUps
    inputTokens
    outputTokens
  }
  class SubAgentBudgetPermit {
    <<DTO>>
    +permitId string
    +scopeId string
    +actionKey string
  }
  class SubAgentBudgetReserveResult {
    <<union>>
    granted
    work_denied
    denied
  }
  class SubAgentBudgetRegistration {
    <<DTO>>
    +registrationId string
    +scopeId string
    +creationKey string
    +generation number
  }
  class SubAgentBudgetRegistrationResult {
    <<union>>
  }
  class SubAgentBudgetRegistrationFinishResult {
    <<union>>
  }
  class SubAgentExecutionRequest {
    <<DTO>>
  }
  class SubAgentExecutionResult {
    <<DTO>>
  }
  class SubAgentImportRequest {
    <<DTO>>
  }
  class SubAgentImportResult {
    <<DTO>>
  }
  class ImportedSubAgentRunOutcome {
    <<DTO>>
  }
  class SubAgentCloseResult {
    <<DTO>>
    +durable boolean
    +recoveryMarkerPersisted boolean
    +failures string[]
  }
  class SubAgentWaitOptions {
    <<DTO>>
  }
  class SubAgentWaitResult {
    <<DTO>>
  }
  class MapSourcesBatchRecord {
    <<DTO>>
  }
  class SubAgentSourcePolicy {
    <<DTO>>
  }
  class SubAgentBudgetPolicy {
    <<union>>
  }
  class validateSubAgentState {
    <<function>>
  }
  class ChatDocumentChange {
    <<DTO>>
    +chatId string|null
  }
  class ChatDocumentCommit {
    <<DTO>>
    +subAgentRevision number|null
  }
  class SavedChatSubAgents {
    <<union>>
  }
  class ChatFileBaseline {
    <<DTO>>
  }
  class ChatStorageError {
    <<error>>
    +code
  }
  class parseSavedChatSubAgents {
    <<function>>
  }
  SubAgentSessionManagerContext --> ParentRunBinding : current binding
  SubAgentSessionManagerContext --> SubAgentDelegationGrant : lookup by opaque ID
  ParentRunDeliveryContext ..> SubAgentDelegationGrant : grant lookup
  SubAgentDelegationGrant *-- ParentRunBinding
  SubAgentDelegationGrant *-- SubAgentSourcePolicy : maximum
  SubAgentDelegationGrant *-- SubAgentBudgetPolicy
  SubAgentStateSnapshot "1" *-- "0..*" SubAgentSessionRecord
  SubAgentStateSnapshot "1" *-- "0..*" SubAgentCreateRecord
  SubAgentStateSnapshot "1" *-- "0..*" SubAgentSubmissionRecord
  SubAgentStateSnapshot "1" *-- "0..*" SubAgentImportRecord
  SubAgentStateSnapshot "1" *-- "0..*" SubAgentPendingAction
  SubAgentStateSnapshot "1" *-- "0..*" SubAgentObservationRecord
  SubAgentStateSnapshot "1" *-- "0..*" SubAgentRecoveryMarker
  SubAgentStateSnapshot "1" *-- "0..*" MapSourcesBatchRecord
  SubAgentBufferedValue --> ValidatedJsonValue : checked fields
  SubAgentBufferedValue ..> SubAgentStateSnapshot : delta к durable base
  SubAgentPendingAction --> SubAgentBudgetPermit
  SubAgentBudgetRequest --> SubAgentBudgetUnit : units по измерениям
  SubAgentBudgetReserveResult --> SubAgentBudgetPermit : granted
  SubAgentBudgetRegistrationResult --> SubAgentBudgetRegistration : registered
  SubAgentBudgetRegistrationFinishResult --> SubAgentBudgetRegistration : завершение регистрации
  SubAgentExecutionRequest --> SubAgentSourcePolicy
  SubAgentExecutionResult ..> SubAgentImportRequest : внутренний результат
  SubAgentImportRequest --> SubAgentExecutionResult
  SubAgentImportResult --> ImportedSubAgentRunOutcome : только зарегистрированный outcome
  SubAgentCloseResult --> SubAgentRecoveryMarker : fallback acknowledgement
  SubAgentWaitResult ..> SubAgentWaitOptions : any или all, bounded timeout
  validateSubAgentState ..> SubAgentStateSnapshot : проверка внешних данных
  ChatDocumentChange --> SubAgentStateSnapshot : секция subAgents
  ChatDocumentChange ..> ChatDocumentCommit : commitChatDocument
  ChatDocumentChange --> ChatFileBaseline : base
  ChatDocumentCommit --> ChatFileBaseline : новый base
  SavedChatSubAgents --> SubAgentStateSnapshot : status ready
  ChatDocumentChange ..> ChatStorageError : conflict, invalid-snapshot, file-too-large
  parseSavedChatSubAgents ..> SavedChatSubAgents : изолированная проверка секции
```

Критические записи: create/queued до receipt, начало внешнего действия, бюджетные маркеры,
terminal, stop/tombstone и import. Они требуют write barrier независимо от таймера.
Буфер содержит дочерние deltas; chat-часть и история секции subAgents не входят в его лимит 256 KiB.
Возврат full означает backpressure вне manager/chat serializer, не потерю обязательного события.
Budget registration и permit lifecycle не позволяют позднему grant возобновить остановленную работу.
