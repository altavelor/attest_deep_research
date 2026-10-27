# Шаг 7 — Один renderer для основного и дочернего timeline

Спецификация. Существующие workflowRenderer.ts, workflow/toolCallNodeRenderer.ts,
workflow/reasoningNodeRenderer.ts и toolCallView.ts находятся в src/apps/obsidian/ui/chat/.
ChainItem и AssistantResearchProgress существуют в src/core/conversation/model.ts.

## 0. Контракт шага

Потребляет SubAgentWorkflowItem из шага 6 и существующие ChainItem, WorkflowRenderContext,
WorkflowUiState, renderWorkflowNodes из workflowRenderer.ts.
Производит новые WorkflowTimelineModel, WorkflowTimelineHandle и функцию:
renderWorkflowTimeline(hostEl: HTMLElement, model: WorkflowTimelineModel,
context: WorkflowRenderContext, uiState?: WorkflowUiState): WorkflowTimelineHandle.
Новый WorkflowTimelineModel = {scopeId:string; items:readonly ChainItem[];
phase:AssistantResearchProgress[«phase»]; mode?:ResearchMode;
reasoningSegments:AssistantResearchProgress[«reasoning»][«segments»];
checkpoints:AssistantResearchProgress[«checkpoints»]}.
Parent adapter передаёт все эти поля из progress без потери статусов; child mapper передаёт
reasoningSegments=[]/checkpoints=[] и явную phase из child run, а не выводит её из calls.
Новый WorkflowTimelineHandle = {rendered:boolean; dispose():void}.
Новый toSubAgentWorkflowModel(sessionId: string, items: readonly SubAgentWorkflowItem[],
phase: AssistantResearchProgress[«phase»]):
WorkflowTimelineModel — mapper child projection, не новый renderer.
Публичные symbols — через новый curated src/apps/obsidian/ui/chat/workflow/index.ts;
существующий workflowRenderer.ts сохраняет совместимый renderWorkflowNodes facade.

## 1. Решение и границы переноса

Выделить общий rendering engine, не копировать разметку второго окна.
Parent adapter переводит текущие chain/legacy reasoning/checkpoints в WorkflowTimelineModel;
child adapter передаёт только tool calls из разрешённой projection, без reasoning.
Когда items непуст, engine использует chain; иначе выводит reasoningSegments в прежнем
порядке, затем checkpoints, пропуская только finalizing как текущий legacy renderer.
Checkpoints участвуют в isFinalizing/hasStreamingCheckpoint независимо от наличия chain;
streaming/interrupted/superseded статусы не теряются при нормализации.
Legacy rendering, instant indicator suppression и parent checkpoint order сохраняются.
Parent модель дополнительно несёт optional `events` (dispatch/notice своего run, шаг 8);
engine вставляет их узлами рельса (agentEventNodeRenderer, иконка в кольце на линии) по
interleaveWorkflowEvents над цепочкой со скрытыми sub-agent строками как якорями (сами строки
не выводятся; sequence есть у tool call, reasoning и checkpoint), а при пустой цепочке — после legacy-узлов. Модель только с events
тоже рендерит список. Child-модели (`sub-agent:`) events не получают.
На этом шаге filtering child-активности в main ещё не включается — это шаг 8.

Разделить pure projection и DOM orchestration. Renderer не читает manager, текущий chat,
provider или settings самостоятельно; всё получает через model/context/callbacks.
Во всех call sites существующие tool labels, badges, fetch targets, timestamps и статусы
отображаются одинаково: текст badge совпадает, tooltip child строится из безопасного кода (SubAgentWorkflowItem.badge), tooltip родительского fallback-badge остаётся прежним и вне объёма этого шага. isDebugMode одинаково управляет In/Out и callback полного output.
В обычном режиме только те safe labels/status/details, которые показывает основной workflow.
Не добавлять child output в DOM, hidden attributes или data-* вне debug.

Child lifetime сортируется по sequence и отображает run/attempt separators как компактные
метки, без выдуманных model answers. Смена prompt/run selection не создаёт новый renderer
и не перестраивает parent transcript. Parent scopeId — message identity, child scopeId —
session identity; tool DOM IDs дополнены run/call identity и не конфликтуют между окнами.

## 2. Ресурсы и взаимодействие

WorkflowTimelineHandle владеет дочерними components, DOM handlers и fetch-target timers.
Перед replacement, переходом list/detail и закрытием modal вызывается dispose ровно один
раз; повтор dispose безопасен. Parent disposeChatTranscript использует тот же handle.
Асинхронный MarkdownRenderer callback после disposal не меняет удалённый DOM;
render generation защищает от устаревшего результата.

Существующие openThinking/tool-cell раскрытия сохраняются по scope+item identity,
не по DOM позиции. Получение нового события не закрывает выбранную пользователем секцию,
не переводит focus и не сбрасывает scroll. На auto-follow внизу допускается скролл только
если пользователь уже был внизу; чтение старой части lifetime не прерывается.
Полный безопасный tool output parent открывается существующим viewer через общий callback; child output
открывается text-only viewer внутри modal (textContent, без Markdown), которым владеет
WorkflowTimelineHandle, и никогда не вызывает ToolOutputViewer: тот пишет файл Attest/tool-output.md в vault и
открывает вкладку, откуда payload нельзя забрать;
клавиатурные Enter/Space и выделение текста работают как прежде.
Переключение debug, dispose handle и close modal закрывают child viewer; запись в vault не происходит.

## 3. Критерии и тесты

Поведение pure file move не требует новых characterization tests; но изменение lifecycle
владеющего handle требует сохранить существующее observable покрытие до изменения.
План роста +1 unit и +1 scenario; остальное — редактирование существующих случаев.

- U1 новый: mapper SubAgentWorkflowItem→ChainItem сохраняет IDs/order/status и не CoT;
  искусственный child fixture не считается доказательством capture, это seam шага 6.
- Редактировать tests/unit/tool-call-node-renderer.test.ts под общий entry point;
  текущие parent labels/nested branch/phase checks сохраняются без дублирования тестов.
- Редактировать tests/scenario/ui/workflow-rendering.behaviour.test.ts для facade,
  сохранять Instant/Thinking/fallback индикацию и legacy порядок, включая chain=[] с
  reasoningSegments+streaming/finalizing/interrupted checkpoint; использовать/изменить
  существующие fixtures/cases без роста test count для переноса.
- Редактировать tests/scenario/ui/debug-mode.behaviour.test.ts: одинаковые In/Out правила
  через parent и child adapters; вне debug ни payload, ни viewer callback не доступны.
- S1 новый: render→update→dispose→late callback через Obsidian stub сохраняет scroll/
  раскрытие, освобождает timers/listeners и не трогает уже удалённый host.
  Если cases объединяются/удаляются, три differential mutants на группу обязательны.

Live L1 после npm run build: открыть существующий Thinking chat в Obsidian, проверить
empty/streaming/long tool output/error/narrow width и debug on/off. Наблюдения по экрану
основного чата обязательны. Child modal ещё не существует, mapper проверен сценарно.
Команды: npm test -- --run tests/unit/tool-call-node-renderer.test.ts
tests/scenario/ui/workflow-rendering.behaviour.test.ts tests/scenario/ui/debug-mode.behaviour.test.ts;
npm run check. Неподтверждённый live screen считается unverified, а не «проверен тестами».

## 4. Отложено

Main transcript filtering, composer button и modal route реализуются следующими шагами.
Общий компонент не становится хранилищем children или владельцем исполнения.
