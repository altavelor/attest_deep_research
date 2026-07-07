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

## Фаза 5 — Fan-out по документам (R5) — DONE
- [x] **5.1** Use-case `MapSources` (`@application/use-cases/map-sources`):
      выбор источников (явный список или дешёвый relevance-pass через
      `retriever.search`), fan-out по одному sub-agent'у на документ,
      ограничение параллелизма (Limiter, дефолт 4), деградация одного
      sub-agent'а в error-строку без падения прогона
- [x] **5.2** Скоуп каждого sub-agent'а: `searchMode: indexOnly`,
      `indexSourcePaths: [sourcePath]`, без notes/web/рекурсии; per-source
      budget через новое поле `SubAgentRunInput.budget` (maxRounds/maxResultChars)
- [x] **5.3** Structured output строки `{sourcePath, stance, keyFindings[],
      evidenceIds[]}`: толерантный парсинг ответа (`STANCE:` + буллеты),
      `citedEvidenceIds` (цитируемые id → иначе весь snapshot)
- [x] **5.4** Тул `map_sources` (`MapSourcesSource`, гейт: subAgentRunner +
      retriever + index-mode); мердж evidence в родительский реестр; label +
      result-summary в `toolCallLabel`
- [x] **5.5** Промпт-скилл `MAP_SOURCES_SKILL`: когда предпочесть fan-out,
      reduce-шаблон **evidence matrix** (документ × позиция, цитата в каждой
      строке, пометка error-строк) — вход для R7
- [x] **5.6** Фикс гейта: sub-agent runner создаётся без web-провайдера, иначе
      `run_subagent`/`map_sources` не регистрировались в чистом Index-режиме

## Фаза 6 — Компиляция знаний в vault-заметки (R6) — DONE
- [x] **6.1** Промпт-скилл `COMPILE_KNOWLEDGE_SKILL` (без новых портов/тулов):
      workflow «скомпилируй знания корпуса по теме X в папку Y» —
      план заметок (survey через `get_source_summary`/`list_index_sources`/
      `search_index`) → исследование каждой (`map_sources`/`search_index`) →
      дедуп (`search_notes` → append через `update_note`, не перезапись) →
      запись с `[[wikilinks]]` + цитатами `[evidenceId]` + сноской (файл, стр.)
- [x] **6.2** Гейт `hasCompileKnowledge` (index читаем + notes пишутся);
      скилл именует только зарегистрированные тулы (drift guard остаётся зелёным);
      тесты присутствия/отсутствия секции
- [ ] **6.3** Ручная приёмка на тестовом корпусе + чек-лист action-honesty

## Фаза 7 — Claim-индекс + поиск противоречий (R7) — DONE
- [x] **7.1** Порт `documentClaims.ts`: `DocumentClaim`
      (`{claimId, chunkId, sourcePath, subject, statement, topicKeys[]}`),
      `SourceDocumentClaims` (+ contentHash/generation), `DocumentClaimStore`,
      `ClaimExtractor`, `FindClaimsOptions`, `ClaimGroup`
- [x] **7.2** Адаптеры: `FileDocumentClaimStore` (`claims/<id>.jsonl`,
      header-строка + строка-на-claim), `LlmClaimExtractor` (строгий JSON-массив,
      толерантный парсер, нормализация subject/topicKeys, `CLAIM_PROMPT_VERSION`)
- [x] **7.3** Извлечение claims — третья задача enrichment-прохода
      (`ClaimExtraction.extractSourceClaims`): по контентным секциям
      (`summarizableSections`, references исключены), concurrency-bounded,
      деградация секции без падения документа; инкрементальность по contentHash
- [x] **7.4** Ретривер `findClaims` (capability) + `RetrievalService` поверх
      чистого `groupClaims` (`@application/use-cases/claims`): группировка по
      subject, multi-document группы первыми, фильтр по subject/topic, кап
- [x] **7.5** Тул `find_claims({subject?, topic?, limit})` (inventory-тул,
      `chunkId` для дословной проверки); в `PROMPT_TOOL_NAMES`
- [x] **7.6** Промпт-скилл `CONTRADICTION_SKILL` (гейт `hasClaims`):
      find_claims → verbatim-проверка через `read_index_chunk` перед вердиктом →
      отчёт «A утверждает…, B утверждает…» с обеими цитатами; перефразировки —
      не противоречие
- [x] **7.7** Composition: claim store в ретривер и в enrichment-сервис
- [x] **7.8** Тесты: `groupClaims` (группировка/фильтр/кап/contradiction
      precondition на ~пары), `parseExtractedClaims`, JSONL round-trip,
      enrichment claims-task (инкрементальность, references пропущены)
- [ ] **7.9** Ручная приёмка: синтетическая пара с противоречием + набор ~20 пар
      на ложноположительные

## Фаза 8 — Качество на масштабе (R8, независимые задачи)
- [x] **8.2 Цитатная верификация** (детерминированно, без LLM): пост-шаг ответа
      `verifyCitations` (`strategies/citationVerification.ts`) — для каждого
      `[evidenceId]`/`[url:…]` окно-претензия перед цитатой сверяется с текстом
      чанка через word-shingle overlap (k=3, порог 0.18); несоответствия →
      `unverifiedCitations` в agentic-диагностику + warning + finding в отчёте
      (report/html). Тесты: overlap/mismatch/multi-occurrence/url-токены/короткие
- [x] **8.1 Дедуп чанков** (детерминированно, retrieval-time — без миграции
      индекс-формата): `dedupeNearDuplicateChunks` (`core/retrieval/dedupe.ts`) —
      по ранжированному candidate-набору word-shingle Jaccard (k=8, порог 0.5;
      short-text fallback на токен-сет), лучший скор выживает, подавлённые копии →
      `duplicates: [sourcePath]` на выжившем; применяется в `RetrievalService.search`
      до среза top-k; проброс в `search_index`-output. Тесты: near-copy/distinct/
      best-score-wins/same-source. NB: это подавление в выдаче; indexing-time
      minhash-кластеры для claim-индекса (R7) — при необходимости отдельно
- [ ] **8.3 LLM-реранк** top-k за флагом профиля (BM25+вектор top-20..50 →
      дешёвая модель, относительная сортировка → top-5; `rerank`-блок в
      диагностику). Нужен порт+адаптер+флаг в settings/UI+изменение search-flow
