# UML: инструменты родительской модели и асинхронные результаты

Источник: шаги 3, 8, 9. Имена новых tools показаны как функции, существующие tools расширяются.

```mermaid
classDiagram
  direction LR
  class ThinkingResearchRunner {
    <<existing>>
  }
  class SubAgentTool {
    <<existing>>
  }
  class get_subagent_result {
    <<new_tool>>
  }
  class wait_subagents {
    <<new_tool>>
  }
  class MapSourcesTool {
    <<existing>>
  }
  class get_map_sources_result {
    <<new_tool>>
  }
  class SubAgentDelegator {
    <<interface>>
  }
  class SubAgentParentCoordinator {
    <<new>>
  }
  class SubAgentRunReceipt {
    <<DTO>>
  }
  class SubAgentResultState {
    <<union>>
  }
  class SubAgentWaitResult {
    <<DTO>>
  }
  class MapSources {
    <<existing>>
  }
  class MapSourcesBatchReceipt {
    <<DTO>>
  }
  class MapSourcesBatchState {
    <<union>>
  }
  ThinkingResearchRunner --> SubAgentTool : делегировать
  ThinkingResearchRunner --> get_subagent_result : получить состояние или outcome
  ThinkingResearchRunner --> wait_subagents : явно ждать
  ThinkingResearchRunner --> MapSourcesTool : делегировать по документам
  ThinkingResearchRunner --> get_map_sources_result : получить matrix
  SubAgentTool --> SubAgentDelegator : create и run
  SubAgentTool ..> SubAgentRunReceipt : быстрый accepted result
  get_subagent_result --> SubAgentDelegator : getResult
  get_subagent_result ..> SubAgentResultState
  wait_subagents --> SubAgentDelegator : waitForResults
  wait_subagents ..> SubAgentWaitResult
  MapSourcesTool --> MapSources : start
  MapSourcesTool ..> MapSourcesBatchReceipt
  get_map_sources_result --> MapSources : getResult
  get_map_sources_result ..> MapSourcesBatchState
  SubAgentParentCoordinator --> SubAgentDelegator : прочитать terminal states
  SubAgentParentCoordinator --> ThinkingResearchRunner : контекст между model rounds
```

Запуск не ждёт результата. getResult не исполняет задачу повторно; waitForResults —
ограниченное ожидание подписки, его timeout/cancel не останавливают ребёнка.
Автоматическая доставка не создаёт второй tool-result для уже завершённого launch callId.
Ошибки и repaired результаты различаются по (runId, resultRevision).
Перед доставкой completed outcome SubAgentImportedEvidenceResolver и importRegisteredSnapshot
включают conversation aliases в run registry (шаг 8, диаграмма 01).
