# UML: экземпляры и границы владения

Объектный срез выражен через classDiagram с пометкой object; имена A/B условные.
Строка classifier указывает тип экземпляра. Это иллюстративные ID и количества.
Facade и inspection — разные объекты с разным набором прав, хотя связаны с одним manager.

```mermaid
classDiagram
  direction LR
  class runtimeA {
    <<object>>
    classifier ChatSessionRuntime
    chatId chat_A
  }
  class managerA {
    <<object>>
    classifier SubAgentSessionManager
  }
  class facadeA {
    <<object>>
    classifier SubAgentDelegator
    parentRun run_A
    deliveryEpoch 1
  }
  class inspectionA {
    <<object>>
    classifier SubAgentInspectionPort
    rights read_and_stop_only
  }
  class sessionA1 {
    <<object>>
    classifier SubAgentSessionRecord
    status running
  }
  class sessionA2 {
    <<object>>
    classifier SubAgentSessionRecord
    status queued
  }
  class receiptA1 {
    <<object>>
    classifier SubAgentRunReceipt
    runId child_run_A1
  }
  class bufferA {
    <<object>>
    classifier ChatWriteBuffer
  }
  class repositoryA {
    <<object>>
    classifier ChatDocumentSubAgentRepository
    section subAgents chat_A
  }
  class modalA {
    <<object>>
    classifier SubAgentSessionsModal
  }
  class runtimeB {
    <<object>>
    classifier ChatSessionRuntime
    chatId chat_B
  }
  class managerB {
    <<object>>
    classifier SubAgentSessionManager
  }
  class bufferB {
    <<object>>
    classifier ChatWriteBuffer
  }
  runtimeA *-- managerA
  managerA ..> facadeA : выдаёт scoped объект
  managerA ..> inspectionA : выдаёт stop-only объект
  managerA *-- sessionA1
  managerA *-- sessionA2
  runtimeA *-- bufferA
  bufferA --> repositoryA
  facadeA ..> receiptA1 : приём без ожидания результата
  modalA --> inspectionA
  runtimeB *-- managerB
  runtimeB *-- bufferB
  note for managerA "Свои queue, records, state и fences"
  note for managerB "Не видит sessionA1/sessionA2"
  note for inspectionA "Не содержит capability create/run/retry"
```

На этом срезе кнопка чата A показывает 1: running только одна сессия.
При переключении на B без истории кнопка скрыта; modal A закрывается.
Разные секции subAgents и managers не означают обязательные разные экземпляры filesystem client:
общие низкоуровневые stateless зависимости допустимы, состояние детей остаётся изолированным.
Одна session может иметь много последовательных runs, но не два одновременно исполняемых.
