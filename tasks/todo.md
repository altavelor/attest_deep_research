# TODO — Ixplorer Core Extraction (Stage 1)

Детали и критерии приёмки: [plan.md](./plan.md). Инвариант каждой задачи: `npm test` + `tsc --noEmit`
зелёные, поведение плагина не меняется.

> **Статус реализации (2026-06-25):** ядро отделено. 532 теста зелёные, `tsc --noEmit` и
> `tsc -p tsconfig.core.json` чисты, `npm run build` воспроизводим. Obsidian импортируется только в
> `adapters/obsidian/`, `ui/`, `settings/SettingsTab`, `main.ts`. Import-gate строг (negative-проверен).
> **Отложено** (косметика/UI, без выгоды для связности): полная экстракция класса `ServiceFactory` (6.2),
> группировка опций `ResearchService` (6.3), разбиение `SettingsTab` (6.5), физический перенос
> tool-классов и `FileChatStore` в adapters (порты/политики уже на месте).

## Фаза 0 — Guardrail
- [ ] **0.1** Import-boundary test (`tests/arch/import-boundaries.test.ts`, режим baseline) + `tsconfig.core.json`

## Фаза 1 — Контракты по доменам (R1/T2)
- [ ] **1.1** `core/model/*` — source, chunk, citation, language *(deps: 0.1)*
- [ ] **1.2** `core/agent/protocol.ts` — чат/модель-протокол, embeddings *(deps: 1.1)*
- [ ] **1.3** `application/ports` — index store / retrieval / web контракты *(deps: 1.1)*
- [ ] **1.4** `research/diagnostics.ts` + `answer.ts`; ужать/удалить `shared/types.ts` *(deps: 1.1–1.3)*
- [ ] ▸ **CHECKPOINT A** — ревью: god-module устранён

## Фаза 2 — Модель разговора из UI (R2/T3,T4)
- [ ] **2.1** `core/conversation/` — модель + чистые reducers; убрать импорт `ui/` из research/chat *(deps: 1.1)*
- [ ] **2.2** `ui/conversationFormatting.ts` — вынести презентационные форматтеры *(deps: 2.1)*

## Фаза 3 — Порты + адаптеры vault (R4/T5)
- [ ] **3.1** Boundary DTO `RetrievalResult` → `application/contracts`; порты vault/retrieval/web/embedding *(deps: 1.1, 1.3)*
- [ ] **3.2** Перенос Obsidian-провайдеров в `adapters/obsidian/` под порты + contract-тест *(deps: 3.1)*

## Фаза 4 — core/agent (R3)
- [ ] **4.1** Поднять/переименовать `Tool` / `ToolManager` / `AgentLoop` в `core/agent/` *(deps: 1.1, 1.2)*

## Фаза 5 — Источники данных (R5)
- [ ] **5.1** `DataSource` + `SourceManager` + `RagSource` end-to-end *(deps: 3.1, 4.1)*
- [ ] **5.2** `WebSource` (search/fetch) *(deps: 5.1)*
- [ ] **5.3** `AttachmentSource`; убрать `availability`-матрицу из `createResearchToolRegistry` *(deps: 5.2)*
- [ ] ▸ **CHECKPOINT B** — ревью: ядро/agent/источники развязаны

## Фаза 6 — Composition + cleanup (T6–T11)
- [ ] **6.1** `ChatRepositoryPort` + `FileChatRepository` (`adapters/filesystem`) *(deps: 2.1)*
- [ ] **6.2** `ServiceFactory` + `ResponsesProviderPolicy` + дедуп экстракторов + убрать settings-утечку *(deps: 3.2, 5.3)*
- [ ] **6.3** Группировка опций `ResearchService` + минимальные порты *(deps: 6.2)*
- [ ] **6.4** Конфигурируемый путь сборки в `esbuild.config.mjs` *(deps: —)*
- [ ] **6.5** Расщепить `SettingsTab.ts` по секциям *(deps: —)*

## Финал
- [ ] **F.1** Import-gate warn → error; `tsconfig.core.json` охватывает весь core+application *(deps: все)*
