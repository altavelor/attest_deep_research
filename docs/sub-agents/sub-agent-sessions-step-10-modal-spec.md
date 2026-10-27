# Шаг 10 — Кнопка агентов и модальное окно

Спецификация пользовательского интерфейса; source — запрос пользователя и master.
Существующие ChatComposer.ts/ChatComposerController.ts/ChatTranscript.ts/AttestChatView.ts
лежат в src/apps/obsidian/ui/chat/. Существующая ChatSourcesModal в sources/ — пример
Obsidian Modal lifecycle, но её специфичный source search не копируется.

## 0. Контракт шага

Потребляет SubAgentInspectionPort, SubAgentInspectionSnapshot, SubAgentInspectionDetail,
SubAgentSessionCard, SubAgentUserStopResult из шага 6;
WorkflowTimelineModel, WorkflowTimelineHandle, renderWorkflowTimeline,
toSubAgentWorkflowModel из шага 7;
ChatSessionManager.getSubAgentInspection(sessionId: string): SubAgentInspectionPort | null
и ChatSessionChangeKind=«sub-agents» из шага 8, managed map_sources из шага 9.
Производит новые SubAgentSessionsModal, SubAgentSessionsController и read-only rendering
модули в src/apps/obsidian/ui/chat/sub-agents/ с curated index.ts и colocated CSS.
Controller получает port/callbacks, не ссылку на весь view и не manager instance.
Новые ChatComposerController options: getActiveSubAgentCount(): number,
hasSubAgentRuns(): boolean и onOpenSubAgents(sessionId?: string): void;
новые ChatComposerRefs.subAgentsButtonEl: HTMLButtonElement и updateSubAgentCount(count:number):void.
Настроить существующий styles.json; все строки — новые i18n keys chat.subAgents.*.
Внешний вид нормативно задан [макетами M1–M7](sub-agent-sessions-step-10-mockups.md).
Хост передаёт ChatTranscript callback onOpenSubAgentSession(sessionId: string): void; он вызывает
тот же onOpenSubAgents(sessionId): modal открывается сразу на детали этой сессии, «Back»
ведёт в список. Если modal уже открыт — он фокусируется и переходит к сессии без второго окна;
неизвестная или чужая сессия показывает пустое состояние списка.

## 1. Кнопка

Кнопка в composer в том же modelRow сразу справа от селектора research mode
(Instant/Thinking), перед индикатором контекста, моделью и submit; при переносе узкой
строки остаётся рядом с селектором (макет M1). При hasAgentRuns=false кнопка
отсутствует в DOM и tab order. После первого принятого запуска появляется, включая
queued при activeCount=0, и остаётся видимой в Instant и после завершения всех агентов.
Текст — иконка агента и целое activeCount: «0», «1», ... .
Фон и рамка всегда серые; при 0 иконка и число серые, при >0 зелёными становятся только
иконка и число. Hover и focus-visible делают серый фон чуть светлее. Это не
disabled-состояние. Accessible name включает
назначение и число; цвет не единственный сигнал. Число не сокращается до «9+».
Пока первый snapshot выбранного чата не загружен, кнопка скрыта; старый snapshot
другого чата не используется. При ошибке обновления сохраняется последнее подтверждённое
состояние этого чата. Переключение выбранного чата перепривязывает кнопку к его snapshot; старый async
callback не обновляет новый чат. Автообновление counts не стирает draft/textarea focus.

Нажатие открывает одно modal, повторное — фокусирует существующее. При 0 доступен список
history/queued/ready и пустое состояние. Отсутствие running не прячет историю.
Кнопки Enter/Space работают стандартно; aria-live polite без озвучки каждого token update.

## 2. Список сессий

При открытии загрузить snapshot; показать loading/empty/error с retry чтения.
Показываются сессии только выбранного при открытии чата, включая terminal history.
Running сверху по политике шага 6; остальные группы не пересортировываются таймером elapsed.
Карточка — одно keyboard-доступное действие выбора session, содержит:

- description из общей политики имени чата, полностью доступную через безопасный tooltip;
- статус, elapsed, реальную модель текущего/последнего run;
- затраченные tokens с признаками «частично»/«нет данных» по шагу 6.
  Длинные model/description не выталкивают время/числа за границы; tooltip не содержит raw prompt.

Список первоначально рендерит максимум 50 карточек, «Показать ещё» добавляет до 50.
Active группа не теряется за history pagination; сортировка до выделения страниц.
Scroll/focus сохраняются по sessionId при обновлениях; новые данные не воруют выбор. Если сфокусированная
карточка исчезла (сессия вышла из загруженных страниц или удалена), focus уходит на заголовок списка.
Параметры pagination нормативны для bounded Mobile DOM, не ограничивают число хранимых сессий.

## 3. Детали в том же modal

Выбор карточки меняет содержимое текущей Modal, не создаёт второй modal stack.
Кнопка «Назад к агентам» возвращает в список с прежним scroll/focus.
Верхний блок: description, status, model, aggregate elapsed, aggregate tokens/partial marker.
Модель соответствует текущему/последнему run; при разных моделях за историю — отметка
«модели менялись», точные snapshots видны в selector запуска.

Ровно две раскрываемые секции, по умолчанию обе свёрнуты:

1. «Начальный промпт»: redacted снимок первого запроса выбранного run с ролями сообщений.
   Для нескольких runs над секциями есть selector run/attempt, default текущий иначе последний.
   Показываются role/content, redacted/truncated markers; not-started/unavailable/evicted —
   явные тексты, не пустое поле и не восстановленный по нынешним settings «промпт».
2. «Ход работы»: единый lifetime timeline session с разделителями run/attempt, всеми
   принятыми tool calls и status по sequence. Selector фокусирует выбранный run, не скрывает
   остальные runs истории. Renderer общий с основным workflow; вне debug те же safe
   labels/status/badges, в debug In/Out и полный безопасный результат через child text-only viewer шага 7.
   Нет child reasoning/CoT даже при debug. Ещё не вызваны инструменты — явное empty state.

Sections не закрываются на live update; длинный prompt — scroll/virtual bounded output,
данные представлены текстом, не исполняются как HTML. Timeline batch по 50 items с явным
«Показать ещё»; pending/selected item не теряется. Изменение debug применяется сразу,
отключение закрывает child output viewer (text-only внутри modal, не ToolOutputViewer) и удаляет payload из DOM;
запись в vault не происходит.
Вытесненные/не записанные debug outputs помечены; повторного model call ради UI нет.

Размер modal на desktop меняется ручками (pointer capture и клавиатура), чистые правила
пределов, шагов и разбора сохранённого размера — в `sub-agents/modalSize.ts`, слушатели
и drag — в `ModalResizeController`, который снимается при закрытии modal (в том числе
посреди drag). Work log получает класс `attest-sub-agents__work-gutter` с отступом
под rail. Подробности — M0 в mockups.

## 4. Остановка и lifecycle

Под обеими секциями располагается «Остановить агента», если card.canStop=true.
Кнопка есть только у сессии с активным run или pending import, владеющий запуск которого
nonterminal; сессии прежних ходов показывают свой реальный статус, а не archived.
Click передаёт только sessionId/expectedRunId (из card.controlRunId) в stopFromUser, немедленно блокирует
повторный click до ack; показывает «Остановка…», обновляется по тому же snapshot stream.
Обновление статистики не блокирует stop. Если stale из-за нового run — обновить карточку и предложить повторный осознанный click, не stop новый run.
Успех/одновременный parent finish сохраняют detail экран с terminal status.
Ошибка durable stop выводит inline error с retry; не закрывает modal и не обещает успех.
Другие children и основной parent run продолжают работать.

Controller lifecycle: одна подписка на scoped port, один обновляемый timer elapsed только
пока modal открыт и есть running; живое время = elapsedMs snapshot плюс performance.now() минус момент
получения snapshot, только для status=running (updatedAt для часов не используется). Detail/title не пересчитывают persistent usage каждую секунду.
Close/back/route change освобождает renderer handle; close снимает subscriptions/timers/
pending DOM callbacks, full-output viewer и async generation. Закрытие ничего не aborts. Ошибка stop, пришедшая после close, показывается host через Notice, а не
в DOM закрытой modal.
Смена selected chat во view закрывает старую modal и возвращает focus к кнопке нового чата,
а если у нового чата она скрыта — к textarea;
delete старого chat закрывает его modal. Запоздалый getSession/stop callback не меняет чужой DOM.
Escape/focus trap/возврат focus используют Obsidian Modal; RTL и Mobile без горизонтального
scroll всей modal. Новый CSS включён в styles.json, hard-coded English UI strings запрещены.

## 5. Критерии и тесты

План +0 unit, +6 scenario в новом tests/scenario/ui/sub-agent-sessions.behaviour.test.ts;
общие fakes только tests/support. Pure сортировка/usage проверена шагом 6, не дублируется.

- S1: без истории кнопки нет в DOM/tab order; create без run её не показывает;
  кнопка стоит в DOM сразу после селектора research mode; первый queued показывает
  серый 0, running — зелёные иконку и число при неизменном сером фоне (state-класс кнопки не зависит от
  count, меняется только дочерний элемент), terminal/reload
  сохраняет серый 0; selected chat без запусков снова скрывает кнопку, draft сохраняется;
  включить состояния queued/running/importing в seam fixture, не pure truth-table.
- S2: modal list loading→error/retry→empty/history, active-first pagination и обязательные
  четыре метрики карточки; неизвестные tokens не выдумывают значения.
- S3: list→detail→back в одном modal, prompt run selection и ровно две collapse секции,
  раскрытие/scroll/focus сохраняются при update; safe long/evicted prompt;
  «Open details» из уведомления основной ленты открывает modal сразу на этой детали.
- S4: real shared renderer в child detail: live tool pending→complete, debug toggle,
  In/Out viewer не обходят redaction, отключение снимает payload и viewer, vault не пишется.
- S5: stop own live session через scoped port, duplicate/stale/failure/parent-terminal race;
  manager semantics шага 6 здесь не повторяются, проверяются UI callbacks/ack/error;
  run меняется между click и вызовом порта, ack использует runId клика, ошибка после close идёт в Notice.
- S6: keyboard/close/chat-switch/delete снимают подписку/timer/renderer и fences late DOM (fake port держит
  getSession/stop через deferred gate из tests/support до смены чата);
  закрытие modal не вызывает stop, selected чужого чата недоступен.
  Изменить существующий composer scenario при добавлении кнопки без отдельного дубля layout;
  переводы включить в существующие locale dictionary checks, не добавлять per-locale cases.

Live L1: npm run build; открыть в Obsidian основной чат, список агентов, детали агента.
Для каждого из трёх экранов проверить empty, длинный текст/модель, error и narrow width,
normal/debug, keyboard и Mobile-совместимую ширину. Проверить фактическое положение кнопки
сразу справа от селектора режима, отсутствие в чате без запусков, появление после первого
принятого run, серый 0/зелёные иконку и число при сером фоне, осветление при hover и то,
что child calls видны только в modal. Сравнить каждый экран с макетами M1–M7.
В отчёте реализации — одна строка наблюдения на каждый экран; непроверенное явно указать.
Тестовый fixture с известными token fields/двумя runs разрешён, реальный LLM wording не pin.

Команды: npm test -- --run tests/scenario/ui/sub-agent-sessions.behaviour.test.ts;
npm run check; npm run test:growth -- origin/main.
Финальная проверка: все требования master и прямой запрос пользователя закрыты,
полноценный Deep Research pipeline при этом не добавляется.
