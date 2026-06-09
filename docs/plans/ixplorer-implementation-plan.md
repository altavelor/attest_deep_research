# Implementation Plan: Ixplorer

## Overview

Build Ixplorer as a local-first Obsidian desktop plugin with a chat pane for research across vault files, PDFs, supported document formats, DuckDuckGo first-result web search, LM Studio chat, LM Studio or Ollama embeddings, and LanceDB storage in a configurable vault-local folder. The plan prioritizes a thin working vertical path early, then expands file support, retrieval quality, and user-facing controls.

## Architecture Decisions

- Use the standard Obsidian TypeScript plugin scaffold with `esbuild`, `manifest.json`, `styles.css`, and `src/main.ts`.
- Keep service boundaries explicit: settings, local model clients, extractors, indexing, retrieval, research orchestration, web search, and UI.
- Use LanceDB through an `IndexStore` adapter so storage details do not leak into indexing or retrieval code.
- Store LanceDB data in a configurable vault-local folder, defaulting to `.ixplorer/index`.
- Use provider interfaces for embeddings and web search so LM Studio/Ollama and DuckDuckGo/SearXNG can evolve independently.
- Build the chat pane as the primary interaction surface. Command palette entries should only open or focus that pane in v1.
- Persist only the final answer to notes. Intermediate research state remains in memory for the current run.

## Dependency Graph

```text
Plugin scaffold and settings
    |
    +-- Shared domain types and typed errors
    |       |
    |       +-- LM Studio chat client
    |       +-- LM Studio/Ollama embedding clients
    |       +-- DuckDuckGo search provider
    |       +-- Extractor interface and extractors
    |               |
    |               +-- Chunking and source metadata
    |                       |
    |                       +-- LanceDB index store
    |                               |
    |                               +-- Index scheduler and controls
    |                                       |
    |                                       +-- Retrieval and ranking
    |                                               |
    |                                               +-- Research service
    |                                                       |
    |                                                       +-- Chat pane UI
    |                                                       +-- Save final answer
```

## Phase 1: Plugin Foundation

### Task 1: Scaffold Obsidian Plugin

**Description:** Create the basic TypeScript Obsidian plugin structure, build tooling, manifest, styles, and test runner so the project can build before feature work begins.

**Acceptance criteria:**

- [ ] `manifest.json` identifies the plugin as `Ixplorer` with plugin id `ixplorer`.
- [ ] `npm run build`, `npm run dev`, `npm run test`, `npm run lint`, and `npm run format` are defined.
- [ ] `src/main.ts` loads and unloads cleanly with no feature logic beyond registration placeholders.

**Verification:**

- [ ] Build succeeds: `npm run build`.
- [ ] Tests pass: `npm run test`.
- [ ] Manual check: plugin can be copied into an Obsidian vault plugin folder and enabled.

**Dependencies:** None.

**Files likely touched:**

- `package.json`
- `manifest.json`
- `tsconfig.json`
- `esbuild.config.mjs`
- `src/main.ts`
- `styles.css`

**Estimated scope:** Medium.

### Task 2: Define Settings and Configuration UI

**Description:** Add persisted plugin settings for LM Studio, Ollama embeddings, LanceDB folder, indexing paths, exclude globs, and web search enablement.

**Acceptance criteria:**

- [ ] Settings include chat model provider base URL, chat model, embedding provider base URL, embedding model, LanceDB vault-local folder defaulting to `.ixplorer/index`, include folders, exclude globs, and DuckDuckGo toggle.
- [ ] Settings tab can edit and persist values.
- [ ] Defaults are local-first and safe, with web search disabled unless explicitly enabled.

**Verification:**

- [ ] Unit tests cover default settings and settings migration.
- [ ] Build succeeds: `npm run build`.
- [ ] Manual check: settings persist after Obsidian reload.

**Dependencies:** Task 1.

**Files likely touched:**

- `src/settings/settings.ts`
- `src/settings/SettingsTab.ts`
- `src/main.ts`
- `tests/unit/settings.test.ts`

**Estimated scope:** Medium.

### Task 3: Add Shared Domain Types and Error Handling

**Description:** Define core interfaces for sources, chunks, citations, model clients, embedding clients, extractors, index store, retrieval, and user-facing errors.

**Acceptance criteria:**

- [ ] Shared types cover source references for Markdown, PDF pages, document files, and web URLs.
- [ ] Recoverable errors map to concise user-facing messages.
- [ ] Service interfaces make UI and core logic testable without Obsidian runtime.

**Verification:**

- [ ] Unit tests cover error message mapping.
- [ ] Type check passes through `npm run build`.

**Dependencies:** Task 1.

**Files likely touched:**

- `src/shared/types.ts`
- `src/shared/errors.ts`
- `tests/unit/errors.test.ts`

**Estimated scope:** Small.

## Checkpoint: Foundation

- [ ] Plugin builds and tests pass.
- [ ] Ixplorer can load in Obsidian with settings visible.
- [ ] The spec and plan still match current decisions.
- [ ] Review with human before implementing storage and model clients.

## Phase 2: Local Model and Embedding Clients

### Task 4: Implement Chat Model Client

**Description:** Add a chat model client for LM Studio and Ollama model listing, chat health checks, and streaming chat completions.

**Acceptance criteria:**

- [ ] Client can list LM Studio models through `/v1/models`.
- [ ] Client can list Ollama models through `/api/tags`.
- [ ] Client supports streaming chat responses for configured LM Studio or Ollama chat model.

**Verification:**

- [ ] Unit tests use mocked `fetch` for success, timeout, unloaded model, and network failure.
- [ ] Manual check: test connection succeeds against a running LM Studio server.

**Dependencies:** Tasks 2, 3.

**Files likely touched:**

- `src/client/chat/ChatModelClient.ts`
- `tests/unit/chat-model-client.test.ts`

**Estimated scope:** Medium.

### Task 5: Implement Embedding Client

**Description:** Add an embedding client for LM Studio and Ollama local embeddings through the configured embedding provider base URL and model.

**Acceptance criteria:**

- [ ] Client can check available LM Studio embedding models through `/v1/models`.
- [ ] Client can check available Ollama embedding models through `/api/tags`.
- [ ] Client can request embeddings for a batch of chunks from LM Studio or Ollama.
- [ ] Errors clearly distinguish unavailable server, missing model, and malformed responses.

**Verification:**

- [ ] Unit tests use mocked `fetch` for success and failure paths.
- [ ] Manual check: embedding test succeeds against a running Ollama server.

**Dependencies:** Tasks 2, 3.

**Files likely touched:**

- `src/client/embeddings/EmbeddingClient.ts`
- `tests/unit/embedding-client.test.ts`

**Estimated scope:** Medium.

### Task 6: Add Settings Connection Tests

**Description:** Wire settings UI actions to test the configured chat model provider and embedding provider endpoints without starting indexing.

**Acceptance criteria:**

- [ ] User can test LM Studio chat connection from settings.
- [ ] User can test the configured embedding provider from settings.
- [ ] Results are shown as Obsidian notices or inline settings status without logging private content.

**Verification:**

- [ ] Unit tests cover service selection logic.
- [ ] Manual check: successful and failed connections show actionable messages.

**Dependencies:** Tasks 4, 5.

**Files likely touched:**

- `src/settings/SettingsTab.ts`
- `src/settings/connectionTests.ts`
- `tests/unit/connection-tests.test.ts`

**Estimated scope:** Medium.

## Checkpoint: Model Connectivity

- [ ] LM Studio chat can be tested from settings.
- [ ] LM Studio or Ollama embeddings can be tested from settings.
- [ ] Network failures are handled without console content leaks.

## Phase 3: Extraction and Chunking

### Task 7: Implement Markdown Extractor and Chunker

**Description:** Extract Markdown vault content with heading trails, block IDs where available, source paths, and stable chunk IDs.

**Acceptance criteria:**

- [x] Markdown files are split into chunks with heading metadata.
- [x] Exclude globs and selected folders are honored.
- [x] Chunk IDs remain stable when unrelated files change.

**Verification:**

- [x] Unit tests cover headings, block IDs, frontmatter, excludes, and large notes.
- [x] Build succeeds: `npm run build`.

**Dependencies:** Tasks 2, 3.

**Files likely touched:**

- `src/extractors/MarkdownExtractor.ts`
- `src/indexing/chunker.ts`
- `tests/unit/markdown-extractor.test.ts`
- `tests/fixtures/markdown/`

**Estimated scope:** Medium.

### Task 8: Implement PDF Extractor

**Description:** Add PDF text extraction with page-level metadata and image-only page handling.

**Acceptance criteria:**

- [x] Extracted chunks include PDF file path and page number.
- [x] Image-only or empty pages are skipped or marked without failing the full file.
- [x] Large PDFs are processed page by page or in bounded batches.

**Verification:**

- [x] Unit tests use representative PDF extraction fixtures.
- [ ] Manual check: a sample PDF produces page-cited chunks.

**Dependencies:** Tasks 3, 7.

**Files likely touched:**

- `src/extractors/PdfExtractor.ts`
- `src/extractors/types.ts`
- `tests/unit/pdf-extractor.test.ts`
- `tests/fixtures/pdf/`

**Estimated scope:** Medium.

### Task 9: Implement Text, EPUB, FB2, and DOCX Extractors

**Description:** Add first-release document extractors behind the shared extractor interface.

**Acceptance criteria:**

- [x] `.txt`, `.epub`, `.fb2`, and `.docx` files can produce text chunks.
- [x] Extractors report unsupported or malformed files as recoverable indexing errors.
- [x] Metadata includes file path and format.

**Verification:**

- [x] Unit tests cover one fixture per supported format.
- [ ] Manual check: mixed-format folder can be indexed without aborting on one bad file.

**Dependencies:** Tasks 3, 7.

**Files likely touched:**

- `src/extractors/TextExtractor.ts`
- `src/extractors/EpubExtractor.ts`
- `src/extractors/Fb2Extractor.ts`
- `src/extractors/DocxExtractor.ts`
- `tests/unit/document-extractors.test.ts`
- `tests/fixtures/documents/`

**Estimated scope:** Medium.

## Checkpoint: Extraction

- [ ] Supported file types produce chunks with citations metadata.
- [ ] Malformed files do not crash indexing.
- [ ] Chunking tests pass for Markdown, PDF, and document formats.

## Phase 4: Local Indexing and Retrieval

### Task 10: Implement LanceDB Index Store

**Description:** Add LanceDB-backed storage in the configured vault-local folder for chunk text, embeddings, source metadata, file hashes, and modification timestamps.

**Acceptance criteria:**

- [x] Index store initializes in the configured vault-local folder.
- [x] Store can upsert, delete-by-source, clear, and query chunks.
- [x] Store handles embedding dimension mismatch with a user-facing rebuild instruction.

**Verification:**

- [x] Integration-style tests cover initialize, upsert, query, delete, and clear.
- [ ] Manual check: index files are created in the configured vault-local folder.

**Dependencies:** Tasks 2, 3, 5, 7.

**Files likely touched:**

- `src/indexing/LanceDbIndexStore.ts`
- `src/indexing/types.ts`
- `tests/unit/lancedb-index-store.test.ts`

**Estimated scope:** Medium.

### Task 11: Implement Index Scheduler and Controls

**Description:** Build the indexing service that scans selected folders, detects changed files, extracts chunks, requests embeddings, writes to LanceDB, and supports pause, resume, clear, and rebuild.

**Acceptance criteria:**

- [x] Manual reindex indexes only included supported files.
- [x] Incremental indexing skips unchanged files by hash and modification time.
- [x] Pause, resume, clear, and rebuild are exposed through settings or chat pane controls.

**Verification:**

- [x] Unit tests cover change detection and scheduler state transitions.
- [ ] Manual check: indexing progress and last indexed time update in Obsidian.

**Dependencies:** Tasks 6, 8, 9, 10.

**Files likely touched:**

- `src/indexing/IndexingService.ts`
- `src/indexing/changeDetection.ts`
- `src/settings/SettingsTab.ts`
- `tests/unit/indexing-service.test.ts`

**Estimated scope:** Medium.

### Task 12: Implement Retrieval and Citation Assembly

**Description:** Add retrieval over LanceDB with semantic ranking, keyword fallback, and citation assembly for Obsidian files, PDF pages, documents, and web URLs.

**Acceptance criteria:**

- [x] Query returns ranked chunks with citation references.
- [x] Keyword fallback returns useful results when embeddings are unavailable or empty.
- [x] Citation formatter creates Obsidian links for vault sources and URL links for web sources.

**Verification:**

- [x] Unit tests cover ranking, fallback, and citation formatting.
- [ ] Manual check: sample indexed vault question returns clickable citations.

**Dependencies:** Tasks 10, 11.

**Files likely touched:**

- `src/retrieval/RetrievalService.ts`
- `src/retrieval/citations.ts`
- `src/retrieval/ranking.ts`
- `tests/unit/retrieval-service.test.ts`

**Estimated scope:** Medium.

## Checkpoint: Local Retrieval

- [ ] User can index selected local files.
- [ ] User can retrieve relevant local chunks with citations.
- [ ] Index can be paused, resumed, cleared, and rebuilt.

## Phase 5: Research Chat and Web Search

### Task 13: Implement DuckDuckGo First-Result Provider

**Description:** Add a DuckDuckGo provider that performs user-initiated web search, fetches and extracts only the first result page, and keeps web data separate from private vault embeddings.

**Acceptance criteria:**

- [x] Web search sends only the user query, never vault content.
- [x] Provider returns title, URL, snippet, retrieval time, fetched-content status, and extracted text when available.
- [x] Only the first DuckDuckGo result page is fetched for v1.

**Verification:**

- [x] Unit tests mock DuckDuckGo responses and confirm no vault content is included.
- [ ] Manual check: a web-enabled research query includes one web result citation.

**Dependencies:** Tasks 2, 3.

**Files likely touched:**

- `src/web/DuckDuckGoSearchProvider.ts`
- `src/web/types.ts`
- `tests/unit/duckduckgo-search-provider.test.ts`

**Estimated scope:** Medium.

### Task 14: Implement Research Service

**Description:** Orchestrate retrieval, optional first-result web search, prompt construction, LM Studio streaming, citations, follow-up questions, and final-answer-only persistence handoff.

**Acceptance criteria:**

- [x] Research prompt includes retrieved evidence and citation IDs.
- [x] LM Studio answer streams back to the caller.
- [x] Final answer contains citations and follow-up questions.

**Verification:**

- [x] Unit tests cover prompt construction, evidence limits, and no-intermediate-persistence behavior.
- [ ] Manual check: a question returns a grounded streamed answer.

**Dependencies:** Tasks 4, 12, 13.

**Files likely touched:**

- `src/research/ResearchService.ts`
- `src/research/prompts.ts`
- `tests/unit/research-service.test.ts`

**Estimated scope:** Medium.

### Task 15: Build Chat Pane UI

**Description:** Add the Ixplorer chat pane with input, streamed answer display, citation list, follow-up questions, indexing status, and controls to open/focus from Obsidian.

**Acceptance criteria:**

- [x] User can open the Ixplorer chat pane from a command palette entry.
- [x] User can ask a question and see a streamed response.
- [x] Citations are visible and clickable.

**Verification:**

- [x] Build succeeds: `npm run build`.
- [ ] Manual check: chat pane works in Obsidian with indexed local content.

**Dependencies:** Tasks 11, 14.

**Files likely touched:**

- `src/ui/IxplorerChatView.ts`
- `src/ui/rendering.ts`
- `src/main.ts`
- `styles.css`

**Estimated scope:** Medium.

### Task 16: Save Final Answer to Note

**Description:** Add the ability to create a new note or append to the active note with the final answer, citations, and timestamp.

**Acceptance criteria:**

- [x] User can save the final answer to a new note.
- [x] User can append the final answer to the active note.
- [x] Saved content includes timestamp, question, answer, citations, and follow-up questions.

**Verification:**

- [x] Unit tests cover note content formatting.
- [ ] Manual check: saved notes render correctly in Obsidian.

**Dependencies:** Task 15.

**Files likely touched:**

- `src/research/answerFormatter.ts`
- `src/ui/IxplorerChatView.ts`
- `tests/unit/answer-formatter.test.ts`

**Estimated scope:** Small.

## Checkpoint: End-to-End Research

- [ ] User can index local content.
- [ ] User can ask a question in the chat pane.
- [ ] User can optionally include the first DuckDuckGo result.
- [ ] User can save only the final answer to a note.

## Phase 6: Hardening and Release Readiness

### Task 17: Privacy and Safety Pass

**Description:** Review data flow, logging, settings copy, and search behavior to ensure vault content stays local by default and private content is not sent to DuckDuckGo.

**Acceptance criteria:**

- [x] No full note, PDF, document, or generated answer content is logged by default.
- [x] Settings clearly distinguish local LM Studio/Ollama calls from external DuckDuckGo calls.
- [x] Web search is user-controlled and does not include vault-derived content.

**Verification:**

- [x] Manual code review of logging and network call boundaries.
- [x] Tests confirm DuckDuckGo provider receives only the user query.

**Dependencies:** Tasks 13, 15.

**Files likely touched:**

- `src/shared/logger.ts`
- `src/settings/SettingsTab.ts`
- `src/web/DuckDuckGoSearchProvider.ts`
- `tests/unit/privacy.test.ts`

**Estimated scope:** Small.

### Task 18: Large Vault Performance Pass

**Description:** Exercise indexing with synthetic large vault fixtures and tune batching, progress updates, cancellation checks, and UI responsiveness.

**Acceptance criteria:**

- [x] Indexing 1,000 Markdown notes and multiple PDFs does not freeze Obsidian.
- [x] Embedding and LanceDB writes happen in bounded batches.
- [x] Pause and resume respond promptly during long indexing runs.

**Verification:**

- [x] Add a synthetic fixture or script for large-vault indexing smoke tests.
- [ ] Manual check: Obsidian remains responsive during indexing.

**Dependencies:** Tasks 11, 15.

**Files likely touched:**

- `src/indexing/IndexingService.ts`
- `src/indexing/batching.ts`
- `tests/unit/indexing-performance.test.ts`

**Estimated scope:** Medium.

### Task 19: Documentation and Manual Test Checklist

**Description:** Add setup docs, LM Studio/Ollama configuration notes, privacy notes, and a manual verification checklist for development builds.

**Acceptance criteria:**

- [x] README explains installation, development, LM Studio setup, Ollama embeddings, and DuckDuckGo behavior.
- [x] Manual checklist covers settings, indexing, retrieval, web search, saving answers, and clearing index.
- [x] Known limitations include no mobile support, no OCR, and SearXNG later.

**Verification:**

- [x] Documentation matches current commands and settings.
- [ ] Manual checklist completed once before release.

**Dependencies:** Tasks 15, 17.

**Files likely touched:**

- `README.md`
- `docs/manual-test-checklist.md`
- `docs/specs/local-lm-studio-obsidian-plugin.md`

**Estimated scope:** Small.

### Task 20: Final Review and Release Build

**Description:** Run full verification, fix release-blocking issues, and produce a clean development release package.

**Acceptance criteria:**

- [x] `npm run build`, `npm run test`, `npm run lint`, and `npm run format` pass.
- [ ] Manual end-to-end checklist passes.
- [x] Release artifacts include `main.js`, `manifest.json`, and `styles.css`.

**Verification:**

- [x] Full command suite passes.
- [x] Manual plugin install works from clean build artifacts.

**Dependencies:** Tasks 17, 18, 19.

**Files likely touched:**

- `README.md`
- Build output files
- Any files needed for release-blocking fixes

**Estimated scope:** Small.

## Parallelization Opportunities

- Tasks 4 and 5 can run in parallel after Tasks 2 and 3.
- Tasks 8 and 9 can run in parallel after Task 7 defines chunking and extractor contracts.
- Task 13 can run in parallel with Tasks 10-12 because web search is separated by provider interfaces.
- Task 17 can begin as a review while Task 18 exercises performance, once core flows exist.

## Risks and Mitigations

| Risk                                                                 | Impact | Mitigation                                                                                                                                               |
| -------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LanceDB dependency may be difficult to bundle in an Obsidian plugin  | High   | Validate bundling in Task 10 before building later retrieval features. Keep `IndexStore` adapter so storage can change if needed with explicit approval. |
| DuckDuckGo HTML or endpoint behavior may be brittle                  | Medium | Keep provider isolated, test with fixtures, and preserve the later SearXNG provider path.                                                                |
| Large PDFs or DOCX/EPUB files may block the UI                       | High   | Process in bounded batches, add cancellation checks, and verify responsiveness in Task 18.                                                               |
| Embedding dimensions can change when users switch models             | Medium | Store embedding model metadata and show a rebuild-index instruction on mismatch.                                                                         |
| Obsidian/Electron networking and CORS behavior may differ from tests | Medium | Add manual checks against LM Studio, Ollama, and DuckDuckGo early.                                                                                       |
| Private content leakage through logs or web search prompts           | High   | Keep web search input limited to the user query, centralize logging, and add privacy tests.                                                              |

## Open Questions

- Which Ollama embedding model should Ixplorer suggest as the default?
