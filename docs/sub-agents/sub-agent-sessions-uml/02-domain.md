# UML: сессии, команды и результаты

Источник: шаги 1, 3, 5. DTO — объекты данных, union — альтернативные формы, enum — значения.
На схеме приведены ключевые поля; нормативный полный состав — в спецификациях.

```mermaid
classDiagram
  direction LR
  class SubAgentSessionRecord {
    <<DTO>>
    +session SubAgentSessionSummary
    +runs SubAgentRunSummary[]
  }
  class SubAgentSessionSummary {
    <<DTO>>
    +subAgentSessionId string
    +chatSessionId string
    +parentRunId string
    +bindingGeneration number
    +status SubAgentSessionStatus
    +activeSubAgentRunId string
    +pendingImportRunId string
    +pendingImportGeneration number
    +lastImportGeneration number
    +runCount number
    +revision number
  }
  class SubAgentRunSummary {
    <<DTO>>
    +subAgentRunId string
    +command string
    +attempt number
    +resultRevision number
    +status SubAgentRunStatus
    +retryOfRunId string
    +continuedFromRunId string
    +usage NormalizedUsage
  }
  class SubAgentSessionStatus {
    <<enum>>
    ready
    queued
    running
    importing
    stopping
    failed
    interrupted
    archived
  }
  class SubAgentRunStatus {
    <<enum>>
    queued
    running
    stopping
    completed
    failed
    interrupted
  }
  class SubAgentSourcePolicy {
    <<DTO>>
    +searchMode
    +indexScope
    +contextPaths string[]
    +allowActiveFile boolean
    +allowNoteMutation false
  }
  class SubAgentScopeReduction {
    <<DTO>>
    +searchMode
    +contextPaths string[]
    +allowActiveFile false
  }
  class SubAgentBudgetPolicy {
    <<union>>
    local
    required_scope
    +scopeId string
  }
  class CreateSubAgentSessionInput {
    <<DTO>>
    +createRequestId string
    +title string
    +maxSearches number
    +resources string[]
  }
  class SubAgentCommand {
    <<union>>
    initial
    follow_up
    continue_partial
    +task string
    +fromRunId string
  }
  class RetrySubAgentCommand {
    <<DTO>>
    +runId string
  }
  class SubAgentRunRef {
    <<DTO>>
    +sessionId string
    +runId string
  }
  class SubAgentRunReceipt {
    <<DTO>>
    +sessionId string
    +runId string
    +submissionId string
    +acceptedAt string
  }
  class SubAgentSubmissionRecord {
    <<DTO>>
    +submissionId string
    +sessionId string
    +normalizedCommandDigest string
    +runId string
    +receipt SubAgentRunReceipt
  }
  class SubAgentResultState {
    <<union>>
    pending
    completed
    failed
    interrupted
    +resultRevision number
  }
  class ImportedSubAgentRunOutcome {
    <<DTO>>
    +run SubAgentRunSummary
    +answerText string
    +importId string
  }
  class ImportedSubAgentEvidenceReference {
    <<DTO>>
    +conversationEvidenceId string
    +conversationSourceId string
    +conversationRevisionId string
    +subAgentEvidenceId string
    +subAgentRunId string
    +attempt number
    +incomplete boolean
  }
  class NormalizedUsage {
    <<DTO>>
    +inputTokens number
    +outputTokens number
    +totalTokens number
    +reasoningTokens number
    +requestCount number
    +modelRounds number
    +toolCalls number
    +durationMs number
    +source
  }
  class SubAgentSessionError {
    <<error>>
    +code string
    +message string
    +details
  }
  class applySubAgentTransition {
    <<function>>
  }
  class reduceSubAgentSourcePolicy {
    <<function>>
  }
  class deriveSubAgentTitle {
    <<function>>
  }
  class recoverSubAgentState {
    <<function>>
  }
  SubAgentSessionRecord "1" *-- "1" SubAgentSessionSummary : header
  SubAgentSessionRecord "1" *-- "0..*" SubAgentRunSummary : история попыток
  SubAgentSessionSummary --> SubAgentSessionStatus
  SubAgentRunSummary --> SubAgentRunStatus
  SubAgentSessionSummary *-- SubAgentSourcePolicy : maximum
  SubAgentSessionSummary *-- SubAgentBudgetPolicy : immutable
  SubAgentRunSummary *-- SubAgentSourcePolicy : effective
  SubAgentRunSummary *-- NormalizedUsage
  CreateSubAgentSessionInput --> SubAgentScopeReduction
  SubAgentCommand --> SubAgentScopeReduction
  RetrySubAgentCommand --> SubAgentScopeReduction
  SubAgentSubmissionRecord *-- SubAgentRunReceipt
  SubAgentRunReceipt ..> SubAgentRunRef : проекция identity
  SubAgentResultState --> SubAgentRunSummary : pending или failure
  SubAgentResultState --> ImportedSubAgentRunOutcome : только completed
  ImportedSubAgentRunOutcome --> SubAgentRunSummary
  ImportedSubAgentRunOutcome "1" o-- "0..*" ImportedSubAgentEvidenceReference
  applySubAgentTransition ..> SubAgentSessionRecord : чистый переход
  applySubAgentTransition ..> SubAgentSessionError : отказ без side effects
  reduceSubAgentSourcePolicy ..> SubAgentSourcePolicy : только сужение
  deriveSubAgentTitle ..> SubAgentSessionSummary : описание первой задачи
  recoverSubAgentState ..> SubAgentSessionSummary : interrupted и archived после crash
```

RunReceipt подтверждает приём queued-команды; он не содержит ответа и не блокирует родителя.
RunSummary.status=completed при session=importing ещё не означает ResultState.completed.
После исчерпанного импорта session=failed при run.status=completed, pending-поля сохранены до retry,
archive или commit нового epoch.
resultRevision меняется при публикации результата, обычная revision — при обновлении состояния.
Нормативные wire discriminants содержат дефисы: follow-up, continue-partial, required-scope.
В enum-узлах они визуально записаны через подчёркивание для переносимости Mermaid.
