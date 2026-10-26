# UML: асинхронная делегация и доставка результата

Участники обозначают роли объектов диаграммы классов. Подписи сообщений описывают
контрактные действия; где нет закреплённого метода, это действие, а не новое имя API.

```mermaid
sequenceDiagram
  autonumber
  participant P as Родительская модель / tools
  participant F as SubAgentDelegator
  participant M as SubAgentSessionManager
  participant W as ChatWriteBuffer
  participant R as ChatRepository
  participant E as SubAgentExecutionPort
  participant I as SubAgentImportCoordinator
  participant B as ChatSubAgentEvidenceBridge
  participant PC as SubAgentParentCoordinator
  P->>F: create(input)
  F->>M: проверить binding и grant
  M->>W: create record + barrier
  W->>R: commitChatDocument(snapshot)
  R-->>W: durable
  W-->>M: barrier завершён
  M-->>P: SubAgentSessionSummary
  P->>F: run(sessionId, initial, submissionId)
  F->>M: принять команду идемпотентно
  M->>W: queued + submission + barrier
  W->>R: commitChatDocument(snapshot)
  R-->>W: durable queued
  W-->>M: barrier завершён
  Note over M,R: Dispatch сохраняется off-lock в основном timeline
  M-->>P: SubAgentRunReceipt
  par Родитель продолжает работу
    P->>P: независимый model round или собственный tool
  and Дочернее исполнение
    M->>M: FIFO / local или required-scope permit
    M->>W: scheduler-start barrier
    W->>R: commitChatDocument(snapshot)
    R-->>W: durable start
    W-->>M: barrier завершён
    M->>E: run(executionRequest)
    E-->>M: observation / usage / tool events
    Note over M,W: Некритичные обновления буферизуются, UI видит их сразу
    E-->>M: SubAgentExecutionResult
    M->>W: runner terminal + import prepare barrier
    W->>R: commitChatDocument(snapshot)
    M->>I: commit(importRequest)
    I->>B: сохранить aliases/provenance
    B->>W: sourceRegistry + chat barrier
    W->>R: commitChatDocument(snapshot)
    R-->>W: durable registry commit
    W-->>B: barrier завершён
    B-->>I: registered aliases
    I->>W: CAS generation + commit barrier
    W->>R: commitChatDocument(snapshot)
    R-->>W: durable completed result
    W-->>I: barrier завершён
    I-->>M: ImportedSubAgentRunOutcome
    M-->>PC: subscribeResults signal
  end
  PC->>F: getResult(sessionId, runId)
  F-->>PC: completed + outcome + resultRevision
  PC-->>P: служебный контекст на следующем model round
  Note over P,PC: Нет второго tool-result старого callId, child answer не UI-сообщение
  P-->>PC: round принят
  PC->>PC: acknowledgeResults(runId, resultRevision)
  opt Родитель пытается завершить ответ при pending children
    PC->>PC: beforeFinalize ждёт сигнал без model polling
    Note over P,PC: Final draft не публикуется как complete до результата или явной отмены
  end
```

Один символический save означает успешный обязательный barrier, а не независимую
конкурирующую запись. Manager/chat/budget serializers освобождаются перед внешним await.
При import failure/timeout getResult выдаёт failed/import-failed и будит родителя;
последующий repair публикует новую resultRevision без повторного исполнения агента.

```mermaid
sequenceDiagram
  autonumber
  participant P as Родительская модель
  participant T as map_sources tool
  participant B as MapSources
  participant A as MapSourcesWorkerAdapter
  participant M as Manager / facade
  P->>T: map_sources(question, sourcePaths)
  T->>B: start(input, requestId)
  B->>B: durable batch intent + selection
  loop Каждый выбранный документ
    B->>A: runSource(stable requestId, sourcePath)
    A->>M: create + run с index-only grant
    M-->>A: SubAgentRunReceipt
    A-->>B: child ref
  end
  B-->>P: MapSourcesBatchReceipt
  P->>P: продолжить независимую работу
  Note over M,B: Workers исполняются в общем FIFO, максимум 4 running на chat
  M-->>B: изменения terminal results
  B->>M: getResult(ref)
  M-->>B: registered outcome или failure
  B->>B: собрать rows в порядке selection + matrix barrier
  P->>B: get_map_sources_result(batchId)
  B-->>P: MapSourcesBatchState с готовой matrix
```

Остановленный worker даёт failed row и не отменяет соседних. До готовности matrix
getResult(batchId) возвращает pending без ожидания workers.
