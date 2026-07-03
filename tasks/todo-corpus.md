# TODO — Corpus Knowledge (Ф0–Ф1)

Спецификация и критерии приёмки: [SPEC-corpus-knowledge.md](../docs/SPEC-corpus-knowledge.md).
Инвариант каждой задачи: `npx tsc --noEmit`, `npm run depcruise` (0 errors), `npm test`,
`npm run build` — зелёные.

## Фаза 0 — Масштаб retrieval (R0, без миграции формата) — DONE
- [x] **0.1** `KeywordPostingLookup`: кэш merged-постингов + длины чанков + avgLength,
      ключ — `manifest.writeId` (WeakMap по состоянию); `rankKeywordLookup` (BM25 поверх
      lookup), `rankKeywordPostings` — тонкий адаптер; `searchFileVectorKeywords`
      не читает диск на повторных запросах; мёртвый `mergeKeywordPostingRows` удалён
- [x] **0.2** Эмбеддинги как `Float32Array` (zero-copy `subarray` поверх буфера шарда);
      `normalizeVector`/`dotProduct` — `ArrayLike<number>`
- [x] **0.3** `tests/unit/keyword-search-scale.test.ts`: p50 ранжирования на 50 тыс.
      чанков < 150 мс; повторный запрос работает после удаления keyword-файлов с диска;
      commit инвалидирует кэш

## Фаза 1 — PDF-заголовки (R1) — DONE
- [x] **1.1** `adapters/extractors/pdfHeadings.ts`: `PdfHeading`, `resolvePdfHeadings`
      (outline ≥ 3 пунктов приоритетнее типографики), `positionHeadings`, `headingPathAt`
- [x] **1.2** `headingsFromTypography`: шрифт > медианы ×1.15 или капс, длина 4–120,
      без завершающей пунктуации; анти-колонтитульный фильтр (повтор на >30% страниц,
      цифры нормализуются); отказ при плотности кандидатов > 2/страницу;
      уровни — кластеры размеров шрифта (макс. 3)
- [x] **1.3** `PdfSourceReference.headingPath?`; `PdfPageTextParser.parseDocument?`
      (страницы + строки со шрифтами + outline через `getOutline`/`getPageIndex`);
      `chunkPdfPage` проставляет `headingPath` по позиции чанка; заголовки кэшируются
      в `PdfTextCache` (in-memory — миграции не нужны); `SimplePdfTextParser` вынесен
      в `pdfSimpleParser.ts` (чистое перемещение).
      *Отступление от SPEC:* `algorithmVersion` НЕ повышен — `headingPath` аддитивен,
      старые индексы валидны; заголовки появляются после пересборки индекса
- [x] **1.4** `chunkHeadingPath()` в inventory: `outlineSections`, `headingMatches`,
      `summarizeSectionsMatch` работают для pdf-чанков; приёмка на реальной книге Перро —
      вручную после пересборки индекса

## Фаза 2 — Секции (R2) — DONE
- [x] **2.1** `read_index_section`: порт `IndexSectionReadOptions/Result` +
      `readFileVectorIndexSection` (границы: ран одинакового headingPath; без заголовков —
      ран между «титульными» чанками ≤ 100 симв., начиная с ближайшего титула; кап
      `maxChars` + курсор, усечённый чанк перечитывается целиком) + метод в
      `FileVectorInventoryStore`/`RetrievalService`/`ResearchRetriever` + тул через
      `defineInventoryTool` (регистрируется автоматически через `INDEX_INVENTORY_TOOLS`)
- [x] **2.1b** Промпт-подсказка в `agenticPrompts`: топ-результат похож на заголовок →
      `read_index_section`, а не сборка соседей `read_index_chunk`
- [x] **2.2** Keyword-формат v2: у постинга опциональный `headingFrequency`
      (термы `headingPath` считаются и в `frequency` — инвариант ≥ 1 и v1-совместимость
      сохранены); скоринг BM25F-lite: `tf_eff = frequency + (W−1)×headingFrequency`,
      `HEADING_WEIGHT = 3`; v1-файлы читаются без изменений (headingFrequency → 0).
      Буст работает после пересборки индекса

## Фаза 3 — Enrichment: метаданные + библиография (R3) — DONE
- [x] **3.1** Порты `application/ports/documentMetadata.ts`: `SourceDocumentMetadata`
      (title/authors/year/abstract/references + provenance), `DocumentMetadataStore`,
      `DocumentMetadataExtractor`, `SharedReference`; `IndexSourceInventoryItem`
      получил опциональный `contentHash` (инкрементальность)
- [x] **3.2** Use-case `EnrichIndexSources` (`application/use-cases/enrichment/`):
      обход источников курсором, скип по `contentHash`, сэмплы head/references
      (секция по outline-заголовку `references|bibliography|литератур…`, иначе хвост),
      прогресс + AbortSignal
- [x] **3.3** Библиография `bibliography.ts` (чистая): нормализация ссылок
      (DOI-регэксп; title-key — первые 12 слов без пунктуации + год),
      `sharedReferences(minSources)` c ключом doi > title:year
- [x] **3.4** Адаптеры `adapters/indexing/metadata/`: `FileDocumentMetadataStore`
      (`<index>/metadata/<sha256(path)>.json`), `LlmDocumentMetadataExtractor`
      (не-стриминговый chat-вызов, строгий JSON-промпт v1, толерантный парсер)
- [x] **3.5** Тулы `get_source_metadata`, `list_shared_references`
      (defineInventoryTool, capability-gated) + методы в `RetrievalService`
      и `ResearchRetriever`; `read_index_chunk`/`read_index_section`
      добавлены в `PROMPT_TOOL_NAMES` (drift-guard)
- [x] **3.6** Composition: `createDocumentMetadataStoreForProfile`,
      `createEnrichmentService` (активный chat-профиль); команда Obsidian
      «Enrich index metadata (bibliography)» с Notice-прогрессом.
      *Решение:* обогащение запускается только явно (команда), не как
      side-effect индексации — траты LLM-токенов видимы пользователю.
      Sidecar-файлы читаются тулами сразу после прогона
- Отложено в Ф4+: саммари, `<index-description>` v2, UI-статус enrichment
  в настройках, фильтры year/author в search_index

## Фаза 3-UI — Единая кнопка запуска + отчёт с метаданными — DONE
- [x] `EnrichmentProfileController`: состояние per profile, `subscribeAll`,
      cancel через AbortSignal, force-режим; строка статуса обогащения в таблице
      («X extracted, Y up to date, Z failed (N sources)»)
- [x] Единая кнопка Actions: start (индекса нет) / update (есть) /
      pause–continue (индексация) / stop (извлечение метаданных); отдельные
      кнопки rebuild/enrich и команда-палитра удалены
- [x] `IndexRunModal`: секции «Index content (embedding)» и «Extract metadata
      (chat model)» с тумблерами; без индекса metadata-секция требует embedding;
      footer Start (новый) или Rebuild+Update; Rebuild недоступен без embedding;
      смена embedding-модели → warning + повышение Update до Rebuild;
      «Re-extract unchanged documents» — принудительное пере-извлечение;
      Esc/✕ — нативное поведение Obsidian Modal
- [x] Оркестрация `runIndexPlan`: секции последовательно, без подтверждений;
      rebuild сносит папку индекса целиком (метаданные включительно);
      `IndexProfile.lastEnrichedAt` после успешного прогона + бэкфилл из
      sidecar-provenance для индексов, обогащённых до появления поля
- [x] Статусы: Suspended > Error > Stale index > Stale metadata
      (`lastIndexedAt > lastEnrichedAt`) > Default; только подсказка, без автозапуска
- [x] Index report: сворачиваемая секция «Index metadata» (модель, последний
      прогон, shared references) + per-file `<details>` (авторы, аннотация,
      список литературы), max-height + вертикальный скролл

## Фаза 4 — Иерархические саммари (R4) — DONE
- [x] **4.1** Порты `documentSummaries.ts`: `SourceDocumentSummaries`
      (sections + document.summary/oneLiner + provenance), `DocumentSummaryStore`,
      `DocumentSummarizer`
- [x] **4.2** Адаптеры: `FileDocumentSummaryStore` (`summaries/*.json`;
      общий `JsonSidecarStore` c metadata-store), `LlmDocumentSummarizer`
      (секция — plain text 2–4 предложения; документ — JSON summary+oneLiner
      с текстовым fallback; `SUMMARY_PROMPT_VERSION`)
- [x] **4.3** `EnrichIndexSources`: саммари — вторая задача того же прохода
      (та же chat-модель и тумблер в модалке); секции из outline (кап 30,
      текст секции ≤ 6k), map-reduce в документное саммари; документы без
      секций — из head-сэмпла; независимая инкрементальность по contentHash
      каждого sidecar-а
- [x] **4.4** `<index-description>` v2 (`algorithmVersion` 2, бюджет 4k):
      блок `Documents:` с one-liner'ами (до 50) вместо «representative sources»;
      описание пересобирается и после enrichment (onComplete)
- [x] **4.5** Тул `get_source_summary` + промпт-стратегия обзорных вопросов
      (саммари → выбор документов → глубокий поиск со `sourcePath`)
- [x] **4.6** Index report: per-file `<details>` «Summary · N sections»
      с документным и секционными саммари

## Фаза 3-UI — Единая кнопка запуска + отчёт с метаданными — DONE
- [x] Команда-палитра убрана; `EnrichmentProfileController` (state per profile,
      subscribeAll, cancel через AbortSignal) + строка статуса обогащения в таблице
- [x] Единая кнопка Actions: start (индекса нет) / update (есть) /
      pause–continue (индексация идёт) / stop (идёт извлечение метаданных);
      отдельные кнопки rebuild и enrich удалены
- [x] `IndexRunModal`: секции «Index content (embedding)» и «Extract metadata
      (chat model)» с тумблерами; без индекса metadata-секция недоступна при
      выключенной embedding; footer Start (новый индекс) или Rebuild+Update;
      Rebuild требует включённой embedding-секции; смена embedding-модели
      показывает warning и повышает Update до Rebuild; Esc/✕ — нативные
- [x] Оркестрация `runIndexPlan`: секции выполняются последовательно без
      дополнительных подтверждений; rebuild сносит папку индекса целиком
      (метаданные включительно — store.clear = rm -rf); `lastEnrichedAt`
      в `IndexProfile` после успешного прогона
- [x] Статусы строки: Suspended > Error > **Stale index** (профиль изменён) >
      **Stale metadata** (`lastIndexedAt > lastEnrichedAt`) > Default;
      автозапуск обновления не выполняется — только подсказка
- [x] Index report: сворачиваемая секция «Index metadata» (модель извлечения,
      последний прогон, общие ссылки из shared bibliography) + per-file
      `<details>` с авторами/аннотацией/списком литературы, max-height + scroll
