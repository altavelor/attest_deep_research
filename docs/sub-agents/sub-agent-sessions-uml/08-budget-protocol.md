# UML: взаимодействие с владельцем required-scope бюджета

Источник: шаг 4. Owner — внешний объект режима Deep Research; его конкретный класс
не вводится спецификацией sub-agent. В local policy эта ветвь не вызывается.

```mermaid
sequenceDiagram
  autonumber
  participant M as SubAgentSessionManager
  participant W as ChatWriteBuffer
  participant BC as SubAgentBudgetCoordinator
  participant BP as SubAgentBudgetPermitPort / scope owner
  participant E as SubAgentExecutionPort
  M->>W: pending create + stable creation key, barrier
  M->>BC: required-scope registration off-lock
  BC->>BP: beginSessionRegistration(scopeId, creationKey)
  alt Scope открыт
    BP-->>BC: registration(generation)
    BC-->>M: registration
    M->>M: CAS binding / fence
    M->>W: published или aborted, barrier
    M->>BC: finish registration off-lock
    BC->>BP: finishSessionRegistration(published или aborted)
    BP-->>BC: accepted либо closed
    BC-->>M: итог регистрации
  else Scope запечатан
    BP-->>BC: stable typed denial
    BC-->>M: отказ регистрации
  end
  Note over M,BP: Только accepted registration позволяет вернуть usable session
  M->>BC: begin execution off-lock
  BC->>BP: beginExecution(scopeId, stable actionKey)
  alt Выдан execution permit
    BP-->>BC: granted permit
    BC-->>M: execution grant
    M->>W: scheduler-start barrier
    loop Каждое metered действие
      M->>W: pending actionKey / ordinal / fence, barrier
      M->>BC: запрос разрешения off-lock
      BC->>BP: reserve(scopeId, request)
      BP-->>BC: single-use permit
      BC-->>M: action grant
      M->>M: CAS полной identity
      BC->>BP: markStarted(permit)
      M->>M: final CAS до side effect
      M->>E: внешний model/tool вызов без промежуточного await
      E-->>M: результат или ошибка
      M->>BC: settlement off-lock
      BC->>BP: settle(permit, consumed или not-started)
      BP-->>BC: durable settlement
      BC-->>M: settlement подтверждён
    end
    M->>BC: завершить execution permit
    BC->>BP: settle(execution permit, consumed или not-started)
  else Work/global denial или port error
    M->>W: terminal failure / recovery key, barrier
    Note over M: Уже выданный run receipt не отменяется задним числом
  end
  opt Global exhaustion / deadline
    BP-->>BC: stable closureId / reason / time
    BC->>BP: claimClosureCleanup(scopeId, closureId)
    BP-->>BC: true ровно одному owner
    BC->>M: cleanup после выхода serializers
    M->>M: fence / abort / terminalize только scope-owned work
    M->>W: закрытие и recovery metadata, barrier
  end
```

Ни manager, ни chat serializer не удерживается при await budget port.
Старое разрешение после stop не возобновляет run: unstarted grant возвращается как
not-started; уже started или неопределённое исполнение учитывается как consumed.
Число execution attempts отдельно от model rounds; несколько rounds не создают новых attempts.
При closure новые регистрации запрещены, pre-seal registrations должны завершиться,
и только после durable drain будущий Deep Research может начать verification.
