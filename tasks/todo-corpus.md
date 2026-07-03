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
