# UML: пользовательская остановка и буфер записи

Источник: шаги 2, 3, 5, 6, 10. Схемы отражают отмену одной сессии и общий буфер записи чата.

```mermaid
sequenceDiagram
  autonumber
  actor U as Пользователь
  participant UI as SubAgentSessionsModal / Controller
  participant IP as SubAgentInspectionService
  participant M as SubAgentSessionManager
  participant E as Execution / AbortSignal
  participant W as ChatWriteBuffer
  participant R as ChatRepository
  U->>UI: Остановить агента
  UI->>IP: stopFromUser(sessionId, card.controlRunId)
  IP->>M: проверить scoped access и expectedRunId
  alt Новый runId уже заменил прежний
    M-->>IP: stale
    IP-->>UI: stale
    UI->>IP: обновить detail
    Note over UI,M: Новый run не останавливается автоматически
  else Тот же run или null без единого run
    M->>M: синхронный fence session / run / import
    M->>M: удалить queued, запретить follow-up/retry
    M->>E: abort только targeted run
    M->>W: archive + import tombstone + barrier
    W->>R: commitChatDocument(snapshot)
    alt durable save успешен
      R-->>W: durable terminal (written true или false)
      W-->>M: barrier завершён
      M-->>IP: архивирование подтверждено
      IP-->>UI: stopped / already-terminal
      UI->>UI: обновить status и кнопку
    else primary и bounded recovery не подтвердили запись
      R-->>W: ChatStorageError (I/O, document-conflict, invalid-snapshot)
      W-->>M: ошибка barrier
      M-->>IP: durable acknowledgement отсутствует
      IP-->>UI: явная ошибка, in-memory fence остаётся
    end
  end
```

controlRunId: active run → pending-import run → последний run → null.
Обычные progress revision не делают stop stale. Если parent terminal уже закрыл сессию,
операция идемпотентно возвращает already-terminal. Modal close не участвует в этой последовательности.

```mermaid
sequenceDiagram
  autonumber
  participant M as Manager / observation producer
  participant UI as Inspection subscribers
  participant W as ChatWriteBuffer
  participant R as ChatRepository
  M-->>UI: немедленная in-memory projection
  M->>W: markDirty(key, revision, checked delta)
  W->>W: заменить старую delta того же key
  Note over W: Таймер от первого dirty, не debounce
  alt 500 ms ИЛИ 128 updates ИЛИ 64 KiB
    Note over W: Не раньше 2000 ms после предыдущего save
    W->>W: собрать снимок и проверить validateSubAgentState
    alt снимок невалиден
      W-->>M: ChatStorageError invalid-snapshot, deltas остаются в буфере
    else снимок валиден
      W->>R: serial commitChatDocument(base + captured deltas + chat)
      R->>R: сравнить файл с baseline
      alt файл изменён внешне и затронут записываемый раздел
        R-->>W: ChatStorageError document-conflict
        Note over W: Снимок остаётся в памяти, flush по таймеру приостановлен, barrier завершаются ошибкой
        W->>W: resolveConflict reload или keep, до выбора содержательная часть не пишется
      else документ принят, при внешней правке только chat-части deltas применяются к свежему документу
        par Новые изменения во время IO
          M->>W: delta с более новой revision
        and Завершение текущей записи
          R-->>W: durable revision R (written true или false)
        end
        W->>W: убрать только записанные revisions
      end
    end
  else Ни один порог не достигнут
    W->>W: оставить bounded deltas в памяти
  end
  opt pending delta bytes достигли hard cap 256 KiB
    M->>W: markDirty(...)
    W-->>M: full
    Note over M,W: Caller ждёт admission off-lock, нет бесконечной очереди promises
    M->>W: flushThrough(R, size)
    W->>R: commitChatDocument(snapshot)
    R-->>W: durable revision либо I/O ошибка
    W-->>M: место освобождено либо явная I/O ошибка
  end
  opt Критическая операция / завершение / остановка
    M->>W: flushThrough(requiredRevision, barrier)
    W->>R: commitChatDocument(snapshot) без ожидания таймера и паузы 2000 ms
    R-->>W: durable acknowledgement
    W-->>M: barrier завершён
    Note over M: Только теперь receipt, side effect или подтверждение terminal
  end
```

Hard cap считает несохранённые дочерние deltas, не chat-часть и не размер durable истории.
Chat-часть передаётся ChatSessionManager как SaveChatInput по ссылке, сохранение чата — всегда barrier.
Не-barrier flush не начинается раньше 2000 ms после завершения предыдущего save.
Ошибка записи не очищает buffer и не подтверждает revision. Один writer на чат исключает
перезапись новым save старым snapshot. Dispose снимает timer, flush входит в общий deadline
закрытия 2000 ms. Удаление чата вызывает discard(): новые записи отвергаются, запись в полёте
дожидается, при ошибке удаления reopen() возвращает буфер. Это предотвращает воскресание удалённого чата.
