# Шаг 10 — макеты кнопки и модального окна

Статус: нормативное приложение к [шагу 10](sub-agent-sessions-step-10-modal-spec.md).
Макеты M1–M7 задают расположение, состав, порядок элементов, состояния и визуальные токены.
Тексты, числа, модели и описания в примерах иллюстративны; пиксели — ориентир, не допуск.
Поведение и lifecycle задаёт шаг 10; при расхождении во внешнем виде действует этот документ.
Основа — текущий вид плагина (`references/plugin_preview.png`), тёмная тема Obsidian по умолчанию.
Строки интерфейса показаны на английском; в коде это i18n keys `chat.subAgents.*`.

Визуальный эталон — [sub-agent-sessions-step-10-mockups.html](sub-agent-sessions-step-10-mockups.html):
самодостаточная страница с артбордами M1–M7, открывается в браузере без сети.
Это экспорт из дизайн-холста: файл не правится вручную, а заменяется новым экспортом
вместе с правкой этого документа. Текстовые требования ниже и HTML описывают одно и то же;
при расхождении между ними действует текст, а расхождение исправляется новым экспортом.

## 0. Общие правила внешнего вида

Используются только CSS-переменные Obsidian и существующие классы плагина; hex-значения
в макетах — их значения в default dark theme и в CSS не переносятся. Светлая тема получает
те же переменные без отдельных правил.

| Элемент                                 | Токен                                                |
| --------------------------------------- | ---------------------------------------------------- |
| Фон modal                               | `--background-primary`                               |
| Фон карточки, метрики, заголовка секции | `--background-primary-alt`                           |
| Фон блока промпта и debug-вывода        | `--background-secondary`                             |
| Рамки и разделители                     | `--background-modifier-border`                       |
| Основной / вторичный текст              | `--text-normal` / `--text-muted`                     |
| Подписи групп и метрик                  | `--text-muted`, 11px, uppercase, semibold            |
| Фон кнопки агентов                      | `--interactive-normal`                               |
| Фон кнопки агентов при hover/focus      | `--interactive-hover`                                |
| Иконка и число кнопки при 0 / при >0    | `--text-muted` / `--color-green`                     |
| Running                                 | `--color-green`                                      |
| Queued                                  | `--text-muted`                                       |
| Importing                               | `--color-purple`                                     |
| Ready                                   | `--color-blue`                                       |
| Stopping, Stopped, Interrupted          | `--color-orange`                                     |
| Failed, ошибка чтения или остановки     | `--text-error`                                       |
| Маркер «partial», «models changed»      | `--text-warning`                                     |
| Кнопка «Stop agent»                     | Obsidian `mod-warning`                               |
| Точки timeline                          | классы общего workflow renderer шага 7 без изменений |

- Статус всегда — цветная точка 8px и текстовая подпись; цвет не единственный сигнал.
- Числа (elapsed, tokens, count) — `font-variant-numeric: tabular-nums`.
- Иконки — `setIcon`: `bot` (кнопка и пустое состояние), `x`, `chevron-left`,
  `chevron-right`/`chevron-down` (карточка и секции).
- Описание в карточке — одна строка с ellipsis; elapsed, статус и tokens не сжимаются,
  длинная модель сжимается первой. Полный текст — в безопасном tooltip `title`.
- Ширина modal на desktop 680px (`min(42.5rem, 92vw)`), на ширине ≤480px — 100%,
  touch targets ≥44px, без горизонтального scroll всей modal, по образцу ChatSourcesModal.

## M1. Кнопка в composer

```text
A  нет принятых запусков — кнопки нет в DOM и tab order
│ +  Index + Web ⌄ │ Thinking ⌄                      ◌  DeepSeek v4 … ⌄  (↑) │

B  запуски были, running нет — серые иконка и 0
│ +  Index + Web ⌄ │ Instant ⌄  ( bot 0 )            ◌  DeepSeek v4 … ⌄  (↑) │

C  3 running, hover — зелёные только иконка и 3, фон светлее
│ +  Index + Web ⌄ │ Thinking ⌄ ( bot 3 )            ◌  DeepSeek v4 … ⌄  (■) │
                              └ tooltip «Sub-agents · 3 running»

D  узкая панель 360px — кнопка остаётся рядом с режимом, справа уходит на новую строку
│ +  Index + Web ⌄  Thinking ⌄  ( bot 12 )  │
│                         DeepSeek v… ⌄ (↑) │
```

1. Кнопка вставляется в `attest-chat__model-row` сразу после dropdown
   `attest-chat__dropdown--research-mode` и перед `attest-chat__context-indicator`.
   Индикатор контекста сохраняет `margin-inline-start: auto`, поэтому модель и submit
   остаются справа. Tab order: … research mode → агенты → модель → submit.
2. Форма — pill высотой 1.75rem, как dropdown строки; `border-radius` полный,
   отступы 0 0.625rem, зазор иконка–число 0.375rem, иконка 15px, число
   `--font-ui-small` semibold.
3. Фон `--interactive-normal` и рамка `--background-modifier-border` не зависят от count.
   При count>0 меняется только цвет иконки и числа на `--color-green`.
4. Hover и `:focus-visible` меняют фон на `--interactive-hover`; focus-visible дополнительно
   показывает стандартное кольцо фокуса. Отдельного disabled-вида нет.
5. Accessible name — «Sub-agents: N running. Open agent sessions», tooltip — «Sub-agents · N running»; оба через
   i18n, число всегда полное.
6. Перенос строки не отрывает кнопку от селектора режима (вариант D); RTL зеркалит порядок.

## M2. Список агентов

```text
┌ Sub-agents ─────────────────────────────────────────────── [x] ┐
│ NVIDIA History Timeline · 2 running · 31 sessions              │
│ RUNNING · 2                                                    │
│ ┌────────────────────────────────────────────────────────────┐ │
│ │ Find primary sources for NVIDIA's 1999 IPO date and in…    │ │
│ │ ● Running  1m 42s  DeepSeek v4 Flash 0731     18.4k tokens │›│
│ └────────────────────────────────────────────────────────────┘ │
│ QUEUED AND HISTORY · 29                                        │
│ │ ● Queued   —       DeepSeek v4 Flash 0731          No data │›│
│ │ ● Ready    3m 05s  DeepSeek v4 Flash 0731     41.0k tokens │›│
│ │ ● Failed   0m 12s  DeepSeek v4 Flash 0731    1.3k · partial│›│
│                     [ Show more (24 older) ]                   │
└────────────────────────────────────────────────────────────────┘
```

1. Заголовок modal «Sub-agents»; подзаголовок — имя чата, число running и всего сессий.
2. Две группы с подписями: «Running · N» сверху и «Queued and history · N» ниже.
   Пустая группа Running не показывается.
3. Карточка — один `<button>` во всю ширину: строка описания, строка метрик
   (статус, elapsed, модель, tokens справа) и `chevron-right`. Рамка running-карточки
   окрашена приглушённым `--color-green`, остальных — `--background-modifier-border`.
4. Tokens: «18.4k tokens»; неполные — «6.2k · partial» цветом `--text-warning`;
   отсутствующие — «No data» цветом `--text-muted`. Ноль не подставляется.
5. «Show more (N older)» — вторичная кнопка по центру под списком.

## M3. Детали агента — состояние по умолчанию

```text
┌ [‹ Back to agents]                                         [x] ┐
│ Find primary sources for NVIDIA's 1999 IPO date and initial    │
│ share price                                                    │
│ ┌STATUS─────┐┌MODEL──────────┐┌ELAPSED·ALL RUNS┐┌TOKENS·ALL RUNS┐│
│ │● Running  ││DeepSeek v4 F… ││ 2m 23s         ││ 24.6k         ││
│ │           ││models changed ││                ││ partial — …   ││
│ Run [ Run 2 · attempt 1 · current · DeepSeek v4 Flash 0731 ⌄ ] │
│ ┌──────────────────────────────────────────────────────────┐   │
│ │ › Initial prompt             Run 2 · 3 messages · redacted│   │
│ │ › Work log             2 runs · 9 tool calls · 1 pending  │   │
│ └──────────────────────────────────────────────────────────┘   │
│ ────────────────────────────────────────────────────────────── │
│ [■ Stop agent]  Stops only this agent. The main answer and     │
│                 other agents keep running. Closing this window │
│                 stops nothing.                                 │
└────────────────────────────────────────────────────────────────┘
```

1. Вверху слева «Back to agents» с `chevron-left`, справа стандартный close Obsidian.
2. Описание — полный текст с переносом, 17px semibold.
3. Четыре метрики сеткой `repeat(4, minmax(0, 1fr))`: Status, Model, Elapsed · all runs,
   Tokens · all runs. Под моделью при смене моделей — «Models changed»; под tokens при
   неполных данных — «Partial» без причины (см. card.usageIncomplete). На ширине ≤480px сетка становится 2×2.
4. Selector запуска — нативный `<select>` с `<label>` «Run»; пункт содержит номер run,
   attempt, состояние и модель. Без нескольких runs selector не показывается.
5. Две секции в одной рамке, обе свёрнуты: заголовок — `<button aria-expanded>` со
   `chevron-right`, справа краткая сводка секции.
6. Под секциями после разделителя — «Stop agent» (`mod-warning`) и пояснение, если
   `card.canStop=true`; иначе вместо кнопки — текст о причине из M5.

## M4. Детали агента — секции раскрыты, debug, остановка

```text
│ [‹ Back to agents]                               DEBUG     [x] │
│ ● Stopping…  DeepSeek v4 Flash 0731 · models changed  2m 31s … │
│ ⌄ Initial prompt                 Run 2 · 3 messages · redacted │
│   SYSTEM        │ You are a research sub-agent … key: [redacted]│
│   USER · CONTEXT│ Context from the parent chat …                │
│                 │ Truncated — 2,140 more characters not stored  │
│   USER · TASK   │ Find primary sources for …                    │
│ ⌄ Work log                     2 runs · 9 tool calls · 1 pending│
│   RUN 1 · ATTEMPT 1 · QWEN3 32B · FAILED ──────────── (dimmed)  │
│   ● Search web  Searching the web                               │
│   ● Fetch web page  Fetching pages 2 · Failed: request timed out│
│   RUN 2 · ATTEMPT 1 · DEEPSEEK V4 FLASH 0731 · SELECTED ─────── │
│   ● Search web  Searching the web          [In] [Out]           │
│   ● Fetch web page  Fetching pages 3       [In] [Out▣]          │
│     ┌ safe full output ──────────────────────────┐              │
│   ● Read source  … · Output removed (chat size limit)         │
│   ◉ Search web  Searching the web…            (pending, pulse)  │
│ ────────────────────────────────────────────────────────────── │
│ [◌ Stopping…]  Waiting for the stop to be saved. …             │
```

1. В debug справа в шапке — бейдж «DEBUG»; вне debug бейджа, In/Out и вывода нет.
2. Раскрытая секция меняет `chevron-right` на `chevron-down`; при live update не сворачивается.
3. Промпт: подпись роли слева/сверху, содержимое — моноширинный текст с `pre-wrap`
   на `--background-secondary`; маркер «redacted» — инлайн-бейдж цвета `--text-error`;
   «Truncated — N more characters not stored» — строка `--text-warning`. Область
   ограничена по высоте и прокручивается.
4. Work log — общий renderer шага 7: те же точки, линия, заголовки и badges, что в
   основном чате. Разделитель run — подпись uppercase с линией до края; выбранный run
   подсвечен `--interactive-accent`, невыбранные приглушены, но не скрыты.
5. In/Out — маленькие вторичные кнопки после заголовка инструмента; активная Out
   показывает безопасный полный вывод ниже. Вытесненный вывод — текст «Output removed».
6. Во время остановки статус в шапке «Stopping…», кнопка disabled с индикатором и
   `aria-busy`, рядом `role=status` с пояснением; метрики продолжают обновляться.

## M5. Служебные состояния и Mobile

```text
Loading            Read error               Empty                 Stop problems
┌ Sub-agents ┐     ┌ Sub-agents ────┐       ┌ Sub-agents ───┐     ┌──────────────────────┐
│ ▭▭▭▭▭       │     │ ! Couldn't load│       │     bot       │     │ ! New run started …  │
│ [skeleton]  │     │   agent sess…  │       │ No agent      │     │ [■ Stop agent] Run 3 │
│ [skeleton]  │     │ The store did… │       │ sessions to   │     │ ! Couldn't save stop │
│ Loading…    │     │ [Retry]        │       │ show          │     │ [Retry stop]         │
└─────────────┘     └────────────────┘       └───────────────┘     └──────────────────────┘
```

1. Loading — три skeleton-карточки и `role=status` «Loading agent sessions…».
2. Read error — блок `role=alert` с рамкой `--text-error`, объяснением, что агенты
   продолжают работу, и вторичной кнопкой «Retry».
3. Empty — пунктирная рамка, иконка `bot`, заголовок и пояснение, что здесь появятся
   агенты этого чата, включая завершённые.
4. Stale stop — предупреждение `--text-warning`: новый run начался, ничего не остановлено;
   кнопка «Stop agent» снова активна для осознанного повторного нажатия, рядом номер run.
5. Stop save failed — `role=alert` «Stop not saved yet. The agent is halted.» и кнопка «Retry stop».
6. Archived session или завершённый parent — кнопки нет, текст причины.
7. Mobile 390px — modal во всю ширину; в карточке метрики переносятся, модель уходит
   отдельной строкой; close 44×44px; горизонтального scroll нет.

## M6. Лента основного чата с уведомлениями

```text
You   Compare when NVIDIA and TSMC each passed $1T, and find primary sources …
DeepSeek v4 Flash 0731
  ● › Thinking
  ● Search web   Searching the web
  ◎ Agent created   Find primary sources for NVIDIA's 1999 IPO date …
  ➤ TASK SENT TO AGENT
    ┌ Find primary sources for NVIDIA's …                    (initial) ┐
    │ ▒ Find primary sources … Prefer SEC filings … (до 4 строк)       │
    │ ● Running                                    [Open details]      │
    └──────────────────────────────────────────────────────────────────┘
  ●  Two agents are researching in parallel. Meanwhile I'll check …
  ✓ AGENT REPLY
    ┌ ● Agent finished   0m 51s · 9.7k tokens · DeepSeek v4 Flash 0731 ┐
    │ Compare TSMC and NVIDIA trillion-dollar milestone dates          │
    │ ▒ Found two usable sources … [1] [2]                             │
    │ [Show full reply]                            [Open details]      │
    └──────────────────────────────────────────────────────────────────┘
  ●  Both agents finished and their sources are imported. Here is …
  ✕ 2 agents closed with this answer · history stays in Agents
```

1. Уведомления — узлы той же вертикальной линии, что и обычный workflow, но вместо точки
   круглая отметка 20px с рамкой `--color-cyan` и иконкой: `bot` (created), `send` (task),
   `check` (finished), `x` (stopped, closed, failed), `alert-triangle` (partial,
   import-failed, not-started). Собственные инструменты родителя остаются фиолетовыми точками.
2. Created — одна строка: «Agent created» и описание (до 80 символов, без переноса
   карточки). Без дублирования задачи: задача идёт следующим узлом.
3. «Task sent to agent» — подпись uppercase 11px и карточка: описание, бейдж вида команды
   (initial, follow-up, retry, continue partial), текст команды до 4 строк с ellipsis,
   строка со статусом и «Open details». Статус берётся из inspection snapshot сессии,
   при reload без snapshot строка статуса не показывается.
4. «Agent reply» — карточка с рамкой по результату (зелёная для finished). Первая строка:
   статус, длительность, tokens, модель; ниже описание задачи; ниже ответ агента до 4 строк
   с chips цитат; «Show full reply» раскрывает ответ на месте до лимита 4 KiB.
5. Неполные usage — «partial usage» цветом `--text-warning`, как в M2.
6. «Open details» открывает modal сразу на деталях этой сессии (M3); кнопка скрыта, если
   host не передал callback. Кнопки карточек ≥44px на Mobile.
7. «N agents closed with this answer» — приглушённая строка без карточки, одна на завершение
   основного ответа; показывается, только если закрыта хотя бы одна сессия.
8. Все тексты — безопасный текст, не HTML; ответ агента и команда проходят redaction до записи.
   Уведомления не отправляются модели и не меняют её историю.

## M7. Каталог уведомлений

Каждый вид — один узел timeline с кольцом и подписью статуса; цвет не единственный сигнал.

| Вид               | Заголовок                             | Тело                                                                | Действие        |
| ----------------- | ------------------------------------- | ------------------------------------------------------------------- | --------------- |
| created, queued   | Agent created · queued                | Описание; «Waiting for a free agent slot»                           | Open details    |
| task initial      | Task sent to agent · initial          | Текст команды                                                       | Open details    |
| task follow-up    | Task sent to agent · follow-up        | Текст команды                                                       | Open details    |
| task retry        | Task sent to agent · retry            | Текст и attempt                                                     | Open details    |
| task continue     | Task sent to agent · continue partial | Текст команды                                                       | Open details    |
| finished          | Agent finished                        | Ответ агента                                                        | Show full reply |
| partial           | Agent finished with a partial result  | Ответ и пояснение о продолжении                                     | Show full reply |
| failed            | Agent failed                          | Безопасная причина без текста провайдера                            | Open details    |
| stopped           | Agent stopped by you                  | «Partial work is kept in the agent history»                         | Open details    |
| interrupted       | Agent interrupted                     | Текст зависит от reasonCode (Obsidian закрыт или причина остановки) | Open details    |
| import-failed     | Agent finished, sources not imported  | Ответ доступен, источники не добавлены                              | Open details    |
| not-started       | Agent not started                     | Причина: бюджет                                                     | Open details    |
| closed            | N agents closed with this answer      | Одна строка, только если closedCount>0                              | Open agents     |
| map_sources batch | Map sources · N documents             | «9 done · 2 running · 1 failed»                                     | Open agents     |

1. Рамка карточки: зелёная для finished, жёлтая для partial, красная для failed и
   import-failed, оранжевая для stopped, interrupted и not-started, нейтральная для
   остальных. Цвета — токены из раздела 0.
2. Batch map_sources — одна запись на весь batch, обновляется на месте; workers уведомлений
   не создают, матрица попадает в основной ответ отдельным путём.
3. Узкая панель 360px: карточка занимает ширину, описание в одну строку с ellipsis, кнопки
   на всю ширину и ≥44px.
4. Прогресс, фазы, tool calls и промежуточные usage уведомлений не создают.

## 6. Проверка соответствия

| Макет | Автоматическая проверка шага 10 | Live L1                          |
| ----- | ------------------------------- | -------------------------------- |
| M1    | S1                              | Положение, цвета, hover, узкая   |
| M2    | S2                              | Группы, метрики, long text       |
| M3    | S3                              | Сетка метрик, свёрнутые секции   |
| M4    | S3, S4, S5                      | Debug, prompt markers, Stopping… |
| M5    | S2, S5                          | Loading/error/empty/stop, Mobile |
| M6    | Шаг 8: S3, U2; шаг 10: S3       | Лента, карточки, Open details    |
| M7    | Шаг 6: U9; шаг 8: S3            | Каждый вид, узкая панель         |

Scenario-тесты проверяют порядок DOM, роли, aria-атрибуты, классы состояний и тексты i18n,
а не пиксели или вычисленные цвета. Соответствие цветам, отступам и hover проверяется в L1:
отчёт содержит одну строку на макет M1–M7 с найденными отличиями или «соответствует».
