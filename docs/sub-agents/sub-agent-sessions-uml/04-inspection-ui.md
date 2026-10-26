# UML: наблюдение, UI, timeline и batch-объекты

Источник: шаги 6–10. Существующие view/composer/MapSources расширяются,
renderer — функция, WorkflowTimelineHandle — объект управления ресурсами.

```mermaid
classDiagram
  direction LR
  class AttestChatView {
    <<existing>>
  }
  class ChatComposerController {
    <<existing>>
  }
  class ChatComposerRefs {
    <<existing_DTO>>
  }
  class SubAgentSessionsController {
    <<new>>
    -inspection
    -subscription
    -elapsedTimer
  }
  class SubAgentSessionsModal {
    <<new>>
    +onOpen()
    +onClose()
  }
  class Modal {
    <<existing>>
  }
  class SubAgentInspectionPort {
    <<interface>>
    +snapshot()
    +getSession(sessionId)
    +subscribe(listener)
    +stopFromUser(sessionId, expectedRunId)
  }
  class SubAgentUserStopResult {
    <<union>>
    stopped
    already_terminal
    stale
  }
  class SubAgentInspectionSnapshot {
    <<DTO>>
    +revision number
    +activeCount number
    +hasAgentRuns boolean
  }
  class SubAgentSessionCard {
    <<DTO>>
    +sessionId string
    +description string
    +status
    +elapsedMs number
    +usageIncomplete boolean
    +canStop boolean
    +controlRunId string_или_null
  }
  class SubAgentInspectionDetail {
    <<DTO>>
    +selectedRunId string_или_null
    +runs
    +initialPrompts
    +lifetime
  }
  class SubAgentModelSnapshot {
    <<DTO>>
  }
  class SubAgentInitialPrompt {
    <<DTO>>
    +runId string
    +state
    +messages
    +redacted boolean
    +truncated boolean
  }
  class SubAgentWorkflowItem {
    <<DTO>>
    +id string
    +runId string
    +sequence number
    +status
    +args
    +resultJson string
    +badge
    +payloadState
  }
  class SubAgentObservationEvent {
    <<union>>
  }
  class SubAgentObservationRecord {
    <<union>>
  }
  class SubAgentDispatchEntry {
    <<DTO>>
    +eventKey string
    +sessionId string
    +runId string
    +body string
    +commandKind
    +attempt number
    +sequence number
  }
  class SubAgentNoticeEntry {
    <<DTO>>
    +eventKey string
    +sessionId string_или_null
    +batchId string
    +runId string_или_null
    +kind
    +replyExcerpt string
    +sequence number
  }
  class ChatTimelineItem {
    <<union>>
    message
    agent_dispatch
    agent_notice
  }
  class ChatDisplayMessage {
    <<existing_DTO>>
  }
  class WorkflowTimelineModel {
    <<DTO>>
  }
  class WorkflowTimelineHandle {
    <<interface>>
    +rendered boolean
    +dispose()
    +closeChildOutputViewer()
  }
  class renderWorkflowTimeline {
    <<function>>
  }
  class toSubAgentWorkflowModel {
    <<function>>
  }
  class WorkflowRenderContext {
    <<existing_DTO>>
  }
  class WorkflowUiState {
    <<existing_DTO>>
  }
  class ChainItem {
    <<existing_union>>
  }
  class NormalizedUsage {
    <<DTO>>
  }
  class MapSourcesBatchReceipt {
    <<DTO>>
  }
  class MapSourcesBatchState {
    <<union>>
    pending
    completed
    failed_или_interrupted
    failed_unknown_batch
  }
  class MapSourcesBatchRecord {
    <<DTO>>
  }
  class SubAgentRunRef {
    <<DTO>>
  }
  class MapSourcesOutput {
    <<moved_DTO>>
  }
  class MatrixRow {
    <<moved_DTO>>
  }
  AttestChatView --> ChatComposerController : кнопка справа от селектора режима
  ChatComposerController --> ChatComposerRefs : refs кнопки и count
  AttestChatView --> SubAgentSessionsController : scoped callbacks
  SubAgentSessionsController --> SubAgentInspectionPort : чтение и stop-only
  SubAgentSessionsController --> SubAgentSessionsModal : список и детали
  Modal <|-- SubAgentSessionsModal
  SubAgentInspectionPort ..> SubAgentInspectionSnapshot : snapshot и subscription
  SubAgentInspectionPort ..> SubAgentInspectionDetail : getSession
  SubAgentInspectionPort ..> SubAgentUserStopResult : stop acknowledgement
  SubAgentInspectionSnapshot "1" *-- "0..*" SubAgentSessionCard
  SubAgentSessionCard --> SubAgentModelSnapshot : модель текущего или последнего run
  SubAgentSessionCard --> NormalizedUsage : aggregate
  SubAgentInspectionDetail --> SubAgentSessionCard
  SubAgentInspectionDetail "1" *-- "0..*" SubAgentInitialPrompt
  SubAgentInspectionDetail "1" *-- "0..*" SubAgentWorkflowItem
  SubAgentObservationEvent --> SubAgentInitialPrompt : model-started
  SubAgentObservationEvent --> SubAgentWorkflowItem : tool-start и tool-end
  SubAgentObservationEvent --> NormalizedUsage : live usage
  SubAgentObservationRecord --> SubAgentObservationEvent : persisted projection
  ChatTimelineItem --> ChatDisplayMessage : обычный контент
  ChatTimelineItem --> SubAgentDispatchEntry : исходящая команда
  ChatTimelineItem --> SubAgentNoticeEntry : уведомление жизненного цикла
  toSubAgentWorkflowModel ..> SubAgentWorkflowItem : input
  toSubAgentWorkflowModel ..> WorkflowTimelineModel : output
  WorkflowTimelineModel --> ChainItem : items
  renderWorkflowTimeline ..> WorkflowTimelineModel
  renderWorkflowTimeline ..> WorkflowRenderContext : debug и callbacks
  renderWorkflowTimeline ..> WorkflowUiState : раскрытия
  renderWorkflowTimeline ..> WorkflowTimelineHandle : возвращает
  SubAgentSessionsModal --> renderWorkflowTimeline : тот же renderer
  SubAgentSessionsController o-- WorkflowTimelineHandle : dispose при навигации
  MapSourcesBatchReceipt "1" o-- "0..*" SubAgentRunRef : запущенные workers
  MapSourcesBatchState --> MapSourcesOutput : только готовая matrix
  MapSourcesBatchRecord --> MapSourcesOutput : durable immutable matrix
  MapSourcesOutput "1" *-- "0..*" MatrixRow
```

Без запусков hasAgentRuns=false — кнопки нет. После первого queued count=0 и серые иконка
и число; только running увеличивает счётчик и делает зелёными иконку и число, фон остаётся серым.
Modal показывает два раскрываемых раздела: initial prompt выбранного run и lifetime сессии.
В обычном режиме видны безопасные tool labels/status; In/Out доступны только в debug.
controlRunId используется как expectedRunId; revision прогресса не является правом остановки.
Закрытие modal освобождает UI-ресурсы, но не вызывает stop.
