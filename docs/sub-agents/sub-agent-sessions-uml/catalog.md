# Каталог покрытия UML

Каждая именованная новая сущность перечислена один раз. Повторения её узла на разных
диаграммах обозначают ту же сущность, а не отдельный класс. Существующие расширяемые
компоненты и переносимые DTO отмечены отдельно ниже.

## Классы исполнения и фасады

[Диаграмма](01-runtime.md).

`SubAgentSessionManager`, `SubAgentSessionManagerFactory`, `SubAgentLifecycle`, `SubAgentHost`, `SubAgentDelegator`, `SubAgentParentCoordinator`, `SubAgentExecutionPort`, `SubAgentEvidenceImportPort`, `SubAgentImportCoordinator`, `ChatSubAgentEvidenceBridge`, `SubAgentImportedEvidenceResolver`, `SubAgentBudgetCoordinator`, `SubAgentBudgetPermitPort`, `ChatWriteBuffer`, `SubAgentDurableWriter`, `SubAgentSessionRepository`, `ChatDocumentSubAgentRepository`, `ChatSubAgentBridge`, `SubAgentInspectionService`, `SubAgentInspectionPort`, `MapSourcesWorkerPort`, `MapSourcesWorkerAdapter`.

## Доменные данные

[Диаграмма](02-domain.md).

`SubAgentSessionRecord`, `SubAgentSessionSummary`, `SubAgentRunSummary`, `SubAgentSessionStatus`, `SubAgentRunStatus`, `SubAgentSourcePolicy`, `SubAgentScopeReduction`, `SubAgentBudgetPolicy`, `CreateSubAgentSessionInput`, `SubAgentCommand`, `RetrySubAgentCommand`, `SubAgentRunRef`, `SubAgentRunReceipt`, `SubAgentSubmissionRecord`, `SubAgentResultState`, `ImportedSubAgentRunOutcome`, `ImportedSubAgentEvidenceReference`, `NormalizedUsage`, `SubAgentSessionError`.

## Права и хранение

[Диаграмма](03-storage-budget.md).

`SubAgentSessionManagerContext`, `ParentRunBinding`, `ParentRunDeliveryContext`, `SubAgentDelegationGrant`, `SubAgentCreateRecord`, `SubAgentStateSnapshot`, `ChatDocumentChange`, `ChatDocumentCommit`, `SavedChatSubAgents`, `ChatFileBaseline`, `ChatStorageError`, `SubAgentImportRecord`, `SubAgentObservationRecord`, `SubAgentRecoveryMarker`, `SubAgentBufferedValue`, `ValidatedJsonValue`, `SubAgentFlushReason`, `SubAgentPendingAction`, `SubAgentBudgetRequest`, `SubAgentBudgetUnit`, `SubAgentBudgetPermit`, `SubAgentBudgetReserveResult`, `SubAgentBudgetRegistration`, `SubAgentBudgetRegistrationResult`, `SubAgentBudgetRegistrationFinishResult`, `SubAgentExecutionRequest`, `SubAgentExecutionResult`, `SubAgentImportRequest`, `SubAgentImportResult`, `SubAgentCloseResult`, `SubAgentWaitOptions`, `SubAgentWaitResult`.

## UI и batch DTO

[Диаграмма](04-inspection-ui.md).

`SubAgentSessionsController`, `SubAgentSessionsModal`, `SubAgentUserStopResult`, `SubAgentInspectionSnapshot`, `SubAgentSessionCard`, `SubAgentInspectionDetail`, `SubAgentModelSnapshot`, `SubAgentInitialPrompt`, `SubAgentWorkflowItem`, `SubAgentObservationEvent`, `SubAgentDispatchEntry`, `SubAgentNoticeEntry`, `ChatTimelineItem`, `WorkflowTimelineModel`, `WorkflowTimelineHandle`, `MapSourcesBatchReceipt`, `MapSourcesBatchState`, `MapSourcesBatchRecord`.

## Чистые функции

[Диаграмма](02-domain.md).

`applySubAgentTransition`, `reduceSubAgentSourcePolicy`, `deriveSubAgentTitle`, `recoverSubAgentState`.

## Валидация состояния

[Диаграмма](03-storage-budget.md).

`validateSubAgentState`, `parseSavedChatSubAgents`.

## Общий renderer

[Диаграмма](04-inspection-ui.md).

`renderWorkflowTimeline`, `toSubAgentWorkflowModel`.

## Новые model tools

[Диаграмма](09-model-tools.md).

`get_subagent_result`, `wait_subagents`, `get_map_sources_result`.

Итого: **102 именованные новые сущности**, включая классы, порты, типы и функции.

Расширяемые существующие компоненты: ChatSessionRuntime, ChatSessionManager, ResearchService,
ThinkingResearchRunner, SubAgentRunner, SubAgentTool, MapSources, MapSourcesTool,
AttestChatView, ChatComposerController, ChatComposerRefs, ChatRepository, EvidenceRegistry,
ResearchEvidenceRegistry, ChatDisplayMessage, WorkflowRenderContext, WorkflowUiState, ChainItem.

Переносимые без смены wire shape DTO: MapSourcesOutput и MatrixRow (adapter → core).

Concrete class исполняющего SubAgentExecutionPort и класса model facade не названы
спецификацией, поэтому UML не присваивает им новые вымышленные имена.
Объекты SubAgentExecutionRequest/Result и другие DTO сокращены до ключевых полей;
полные типы и ограничения остаются нормативными в документах шагов.
