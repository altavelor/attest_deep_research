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
