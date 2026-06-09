# Implementation Plan: Pure JavaScript Vector Store

## Overview

Replace the native LanceDB runtime dependency with a pure JavaScript, file-backed vector index store that can ship through the Obsidian Community Plugins distribution model as ordinary plugin assets. The new store should preserve the existing `IndexStore` contract used by indexing and retrieval while avoiding platform-specific `.node` binaries, package-manager installs, and unresolved module specifiers inside Obsidian.

The recommended first implementation is a sharded hybrid file format: JSON for schema, source snapshots, chunk metadata, and keyword postings, plus binary `Float32Array` sidecars for embeddings. This keeps the store inspectable while avoiding the size and parse-time costs of serializing every vector as JSON.

## Current State

- `src/indexing/LanceDbIndexStore.ts` implements the `IndexStore` interface using LanceDB.
- `src/indexing/RealLanceDbDriver.ts` dynamically imports `@lancedb/lancedb`, which depends on platform-specific native packages such as `@lancedb/lancedb-darwin-arm64`.
- Obsidian Community Plugin installation normally downloads `main.js`, `manifest.json`, and optional `styles.css`, but does not install npm platform packages.
- Indexing already writes stable chunk IDs, source metadata, content hashes, embedding model names, and embeddings.
- Retrieval only needs `initialize()`, `upsert()`, `deleteBySourcePath()`, `clear()`, and `query()`.
- Current tests exercise the `IndexStore` behavior through fake and real LanceDB store tests.
- The indexing pipeline is already extractor-driven, which is the right direction for Ixplorer's broader file support: Markdown, PDF, `.fb2`, `.epub`, `.txt`, and `.docx`.
- `obsidian-llm-hub` demonstrates a useful pure-JS storage precedent: store metadata in `index.json`, store vectors separately in `vectors.bin`, query with exact cosine similarity, and expose `topK`, score thresholds, file-extension filters, and resumable sync behavior.
- Public data on typical Obsidian vault sizes is mostly anecdotal. Community discussions show many active vaults in the hundreds to low-thousands of notes, power-user vaults around several thousand notes, and stress-test or outlier vaults around 10k-20k+ notes. The first benchmark targets should therefore cover common active vaults and a credible power-user ceiling rather than assume a single average.

## Goals

- Remove mandatory runtime dependency on `@lancedb/lancedb`.
- Keep plugin distribution compatible with a single bundled `main.js` plus normal Obsidian plugin assets.
- Preserve semantic vector search behavior for local vaults.
- Keep the implementation inspectable, deterministic, and easy to migrate.
- Avoid introducing a browser-incompatible storage dependency or a new native package.
- Keep Ixplorer's extractor-first indexing model so adding document formats does not require adding storage-specific branches.
- Avoid storing embeddings as JSON arrays in the normal runtime path.
- Support multiple named local indexes with different settings, so a user can maintain separate indexes for different vault folders, document sets, embedding models, or retrieval profiles.
- Keep indexes refreshable and stale-aware so each named index can be updated in time without forcing a full rebuild of unrelated indexes.
- Use source-path hash sharding from day one so updates to one source rewrite only the affected shard.
- Persist source snapshots separately in `sources.jsonl` so incremental skip state survives plugin reloads.
- Provide a lightweight inverted keyword index in JSON/JSONL as the first keyword fallback implementation.

## Non-Goals

- Implement approximate nearest neighbor indexing in the first version.
- Match LanceDB performance for hundreds of thousands of vectors.
- Add a remote vector database service.
- Change embedding providers, chunking, or retrieval prompts.
- Build a general-purpose database abstraction beyond the current `IndexStore` contract.
- Add multimodal image, audio, or video embeddings in the first version.
- Add SQLite, SQLite WASM, or ANN indexing as a required runtime dependency in the first version.
- Implement cross-index ranking fusion beyond simple merged search in the first version.
- Implement full BM25, stemming, phrase search, or language-specific tokenization in the first keyword index version.

## Architecture Decisions

- Implement a new `FileVectorIndexStore` that satisfies `IndexStore`.
- Rename the user-facing setting from "LanceDB folder" to "Index folder" immediately when the file-backed store lands. Keep the existing `lanceDbFolder` setting key only as a backwards-compatible persisted field until a later settings migration can rename it safely.
- Model storage around named index profiles. Each profile has its own folder under the configured index root, its own manifest, chunk metadata, vector file, filters, embedding metadata, and refresh state.
- Use a hybrid JSON + binary format:
  - `profiles.json` for named index profile definitions and the active/default profile.
  - `<profile-id>/manifest.json` for schema version, embedding model, embedding dimensions, file format version, write metadata, source filters, shard list, keyword index file list, and source snapshot file name.
  - `<profile-id>/sources.jsonl` for one source snapshot row per indexed source path.
  - `<profile-id>/shards/<shard-id>.chunks.jsonl` for chunk rows and source metadata, one row per stored chunk.
  - `<profile-id>/shards/<shard-id>.vectors.bin` for contiguous `Float32Array` vectors in the same order as the shard's chunk metadata.
  - `<profile-id>/keywords/<shard-id>.terms.jsonl` for keyword postings aligned one-to-one with vector shards.
- Version the format from day one and treat unsupported schema versions as rebuild-required, not as a silent empty index.
- Use source-path hash sharding from day one. Default to 32 shards per profile. Shard count is profile-level metadata, and changing shard count requires a full rebuild of that profile.
- Build multi-index support at the profile/control layer first; each individual profile uses the sharded file-backed format.
- Load chunk metadata and vectors lazily on first query or mutation, then keep them in memory for the plugin session. Keep cache invalidation explicit after writes, clear, rebuild, and settings changes.
- Query with exact cosine similarity linear scan in version 1.
- Normalize embeddings at write time so query scoring can use dot product on normalized vectors. If raw vectors must be preserved later, store norms as derived metadata.
- Use atomic commit semantics: write all changed files to temporary names, then publish a new `manifest.json` last. A manifest pointing at complete files is the source of truth.
- Treat missing index files as an empty index for that profile, not as an error.
- Treat corrupt JSON/JSONL, vector length mismatch, missing listed shard files, embedding model mismatch, keyword index mismatch, missing source snapshots, and embedding dimension mismatch as `INDEX_REBUILD_REQUIRED` with a clear user-facing message.
- Keep LanceDB code removable after migration unless a later decision keeps it as an optional experimental backend.
- Keep keyword fallback separate from vector storage. Add a lightweight `KeywordIndex` implementation backed by JSON/JSONL posting files rather than hiding keyword behavior in `IndexStore.query()`.

## Data Model

```ts
interface IndexProfile {
  id: string;
  name: string;
  indexFolder: string;
  includeFolders: string[];
  excludeGlobs: string[];
  embeddingModel: string;
  embeddingProviderBaseUrl: string;
  sourceKinds?: Array<SourceReference["kind"]>;
  refreshMode: "manual" | "onStartup" | "onVaultChange";
  shardCount: 32;
  keywordIndex: {
    enabled: boolean;
    strategy: "source-shard";
    minTokenLength: number;
  };
  createdAt: string;
  updatedAt: string;
}

interface FileVectorManifest {
  schemaVersion: 1;
  format: "ixplorer-file-vector-index";
  profileId: string;
  embeddingModel: string;
  embeddingDimensions: number;
  vectorEncoding: "float32-le-normalized";
  sourceSnapshotFile: "sources.jsonl";
  shardCount: number;
  shards: FileVectorShardManifest[];
  keywordIndex: KeywordIndexManifest;
  chunkCount: number;
  sourceCount: number;
  updatedAt: string;
  writeId: string;
}

interface FileVectorShardManifest {
  id: string;
  chunkMetadataFile: string;
  vectorFile: string;
  chunkCount: number;
  vectorByteLength: number;
}

interface FileVectorChunkRow {
  id: string;
  source: SourceReference;
  sourcePath?: string;
  text: string;
  contentHash: string;
  embeddingModel: string;
  vectorOffset: number;
  vectorLength: number;
  chunkIndex?: number;
}

interface SourceSnapshot {
  sourcePath: string;
  modifiedTime: number;
  contentHash: string;
  indexedAt: string;
  shardId: string;
  chunkCount: number;
  failed?: boolean;
  errorMessage?: string;
}

interface KeywordIndexManifest {
  schemaVersion: 1;
  tokenizer: "simple-lowercase";
  strategy: "source-shard";
  minTokenLength: number;
  files: string[];
  indexedChunkCount: number;
}

interface KeywordPostingRow {
  term: string;
  postings: Array<{
    chunkId: string;
    frequency: number;
  }>;
}
```

Initial profile layout:

```text
.ixplorer/index/
  profiles.json
  default/
    manifest.json
    sources.jsonl
    shards/
      00.chunks.jsonl
      00.vectors.bin
      01.chunks.jsonl
      01.vectors.bin
      ...
    keywords/
      00.terms.jsonl
      01.terms.jsonl
      ...
  literature/
    manifest.json
    sources.jsonl
    shards/
    keywords/
```

## Benchmark Assumptions

There is no reliable public telemetry for the average Obsidian vault size. Use these targets until Ixplorer has its own opt-in or manually reported benchmark data:

- Common active vault: 500-3,000 Markdown notes, modest attachments.
- Power-user vault: 3,000-10,000 Markdown notes, hundreds to low-thousands of attachments.
- Large stress target: 20,000 Markdown notes, because Obsidian community discussions cite this as a known desktop stress-test scale.
- Document-heavy research target: 1,000-5,000 notes plus 100-500 indexed PDFs/documents.

First-release performance tests should target chunk counts, not only file counts:

- Baseline: 10,000 chunks.
- Power-user: 50,000 chunks.
- Stress: 100,000 chunks, allowed to be slower but must not corrupt the index or freeze indefinitely.

If the 50,000 chunk target is not acceptable with the default shard count, increase shard count or tune shard compaction before release.

## Dependency Graph

```text
Pure JS store data format
    |
    +-- File adapter and atomic commit utilities
    |       |
    |       +-- FileVectorIndexStore implementation
    |       |
    |       +-- SourceSnapshotStore implementation
    |       |
    |       +-- LightweightKeywordIndex implementation
    |               |
    |               +-- Store contract tests
    |               |
    |               +-- Index profile manager
    |               |
    |               +-- Retrieval options and keyword fallback guardrails
    |               |
    |               +-- Plugin wiring in main.ts
    |                       |
    |                       +-- Remove LanceDB from runtime build
    |                       |
    |                       +-- Migration / cleanup docs
    |
    +-- Retrieval performance guardrails
```

## Phase 1: Contract and Storage Format

### Task 1: Define the File-Backed Index Format

**Description:** Add a documented file format for manifest metadata, chunk metadata, and binary vector storage. Keep it versioned from the beginning so future migrations can be explicit.

**Acceptance criteria:**

- [ ] Format includes `schemaVersion`, format name, embedding model, embedding dimensions, vector encoding, shard list, source snapshot file, keyword index manifest, chunk count, source count, write ID, and last updated timestamp.
- [ ] Chunk rows include all fields needed to reconstruct `RetrievedChunk` without reading source files.
- [ ] Source snapshots are stored in `sources.jsonl`, not in `manifest.json`.
- [ ] Embeddings are stored in shard-local `*.vectors.bin` files as normalized `Float32Array` data, not as JSON arrays.
- [ ] The manifest validates that each shard's `*.chunks.jsonl` row count and `*.vectors.bin` length match the expected chunk count and dimensions.
- [ ] Keyword posting files are included in the manifest and can be validated against the chunk count.
- [ ] Missing files represent an empty index.
- [ ] Mismatched embedding metadata, corrupt JSONL, unsupported schema version, missing source snapshots, keyword posting mismatch, or vector length mismatch produces `INDEX_REBUILD_REQUIRED`.
- [ ] The format uses source-path hash sharding from day one.
- [ ] The format supports multiple named profiles under one index root.

**Verification:**

- [ ] Unit tests cover reading missing files as empty state.
- [ ] Unit tests cover metadata mismatch.
- [ ] Unit tests cover vector length mismatch, corrupt chunk metadata, corrupt source snapshots, and corrupt keyword postings.
- [ ] Type check succeeds: `npm run lint`.

**Dependencies:** None.

**Files likely touched:**

- `src/indexing/IndexProfileManager.ts`
- `src/indexing/SourceSnapshotStore.ts`
- `src/indexing/LightweightKeywordIndex.ts`
- `src/indexing/FileVectorIndexStore.ts`
- `tests/unit/file-vector-index-store.test.ts`

**Estimated scope:** Small.

### Task 2: Add Atomic File Commit Utilities

**Description:** Implement small helpers for safe JSON, JSONL, and binary read/write operations through Node filesystem APIs or the Obsidian adapter path already resolved by the plugin.

**Acceptance criteria:**

- [ ] Reads return typed data or a fallback for missing files.
- [ ] Writes use temp-file-then-rename semantics for each shard chunk file, vector file, source snapshot file, and keyword posting file.
- [ ] A new `manifest.json` is published last so readers never trust half-written shard/source/keyword files.
- [ ] Corrupt JSON, corrupt JSONL, keyword posting mismatch, and binary length mismatch return a user-facing rebuild-needed error.
- [ ] Parent directories are created before writing.
- [ ] Temporary files from interrupted writes can be ignored or cleaned up safely.
- [ ] Atomic writes are scoped per profile, so committing one profile cannot corrupt another profile.

**Verification:**

- [ ] Unit tests cover missing files, corrupt JSON, corrupt JSONL, vector length mismatch, keyword posting mismatch, stale temp files, and successful atomic commits.
- [ ] Type check succeeds: `npm run lint`.

**Dependencies:** Task 1.

**Files likely touched:**

- `src/indexing/fileIndexFiles.ts`
- `src/indexing/sourcePathShard.ts`
- `tests/unit/file-index-files.test.ts`

**Estimated scope:** Small.

## Phase 2: Store Implementation

### Task 3: Implement `FileVectorIndexStore`

**Description:** Create a pure JavaScript `IndexStore` implementation with in-memory caching, JSONL chunk metadata, and binary vector persistence.

**Acceptance criteria:**

- [ ] `initialize()` creates or validates metadata.
- [ ] `upsert()` replaces chunks by ID and persists chunk metadata and normalized vectors.
- [ ] `upsert()` writes only affected source-path hash shards when possible.
- [ ] `deleteBySourcePath()` removes all chunks for the path from its shard and persists changes.
- [ ] `clear()` fully removes the profile manifest, chunk metadata, vectors, temporary files, and in-memory cache.
- [ ] `query()` returns top-k chunks ordered by score using exact linear scan.
- [ ] Query supports an optional score threshold through retrieval-layer options if the shared `RetrievalOptions` contract is extended.
- [ ] Query supports extension/source filtering through retrieval-layer options if the shared `RetrievalOptions` contract is extended.
- [ ] Empty indexes return an empty result list.
- [ ] Query scoring avoids per-document allocations in the hot loop.
- [ ] Store instances are profile-scoped so multiple indexes can coexist without shared mutable state.
- [ ] Shard cache loading is lazy and can load shard metadata/vectors independently.

**Verification:**

- [ ] Store contract tests pass for initialize, upsert, replace, delete, clear, and query.
- [ ] Tests verify score ordering and returned `SourceReference` data.
- [ ] Tests verify normalized vector scoring and deterministic scores.
- [ ] Type check succeeds: `npm run lint`.

**Dependencies:** Tasks 1 and 2.

**Files likely touched:**

- `src/indexing/FileVectorIndexStore.ts`
- `src/indexing/sourcePathShard.ts`
- `tests/unit/file-vector-index-store.test.ts`
- `tests/unit/lancedb-index-store.test.ts` only if extracting shared contract tests.

**Estimated scope:** Medium.

### Task 4: Add Performance Guardrails for Linear Scan

**Description:** Add focused tests and small optimizations so exact search remains acceptable for typical Obsidian vault sizes.

**Acceptance criteria:**

- [ ] Query scoring avoids unnecessary object allocation in the hot loop.
- [ ] Scores are deterministic for identical inputs.
- [ ] A medium-sized synthetic index performance test exists with a realistic upper bound.
- [ ] Performance tests cover vector file load time and query time separately.
- [ ] Performance tests include 10,000, 50,000, and 100,000 synthetic chunk targets.
- [ ] Performance tests include a document-heavy fixture model approximating 1,000-5,000 notes plus 100-500 indexed PDFs/documents.
- [ ] The implementation is still straightforward enough to debug.
- [ ] Follow-up thresholds are documented for when to introduce sharding, JSONL compaction, or a pure JS/WASM ANN backend.
- [ ] The plan documents shard-count tuning thresholds if the 50,000 chunk target is not acceptable with the default shard count.

**Verification:**

- [ ] `tests/unit/indexing-performance.test.ts` includes file-vector store coverage or a new performance test file.
- [ ] Full test suite passes: `npm test`.

**Dependencies:** Task 3.

**Files likely touched:**

- `src/indexing/FileVectorIndexStore.ts`
- `src/indexing/LightweightKeywordIndex.ts`
- `tests/unit/file-vector-index-store.test.ts`
- `tests/unit/indexing-performance.test.ts`

**Estimated scope:** Small.

## Phase 3: Integration

### Task 5: Add Index Profile Settings and Manager

**Description:** Add a profile layer above the store so Ixplorer can maintain multiple local indexes with different include/exclude filters, embedding settings, and refresh behavior.

**Acceptance criteria:**

- [ ] A default profile is created from existing settings on first load.
- [ ] Users can rename the index folder label to "Index folder" without losing existing settings.
- [ ] Each profile stores include folders, exclude globs, embedding provider URL, embedding model, refresh mode, and index folder path.
- [ ] Each profile stores shard count and keyword-index enabled state, defaulting to enabled.
- [ ] Default shard count is 32, and changing shard count requires a full rebuild of that profile.
- [ ] Profiles can be listed, selected as active, created, updated, and deleted.
- [ ] Deleting a profile asks for confirmation and fully removes that profile's index files.
- [ ] Marking one profile stale does not mark unrelated profiles stale.

**Verification:**

- [ ] Unit tests cover migration from current single-index settings to the default profile.
- [ ] Unit tests cover profile create/update/delete and active profile selection.
- [ ] Manual check: create two profiles with different folder filters and verify they maintain separate index state.

**Dependencies:** Tasks 1 and 2.

**Files likely touched:**

- `src/settings/settings.ts`
- `src/settings/SettingsTab.ts`
- `src/indexing/IndexProfileManager.ts`
- `src/indexing/IndexingController.ts`
- `tests/unit/settings.test.ts`
- `tests/unit/index-profile-manager.test.ts`

**Estimated scope:** Medium.

### Task 6: Wire the Plugin to Use the File-Backed Store

**Description:** Replace `LanceDbIndexStore` construction in `src/main.ts` with the new pure JS store for both indexing and retrieval.

**Acceptance criteria:**

- [ ] Indexing uses `FileVectorIndexStore`.
- [ ] Retrieval uses the same storage folder and can query chunks written by indexing.
- [ ] Existing settings continue to work without requiring a settings migration.
- [ ] Missing or empty index folders do not throw during chat search.
- [ ] Index folder path is migrated from the existing `lanceDbFolder` setting key into the default profile, while the user-facing label becomes "Index folder".
- [ ] The indexing controller exposes clear/rebuild states that distinguish empty index, stale index, deferred files, failed files, and rebuild-required index.
- [ ] Retrieval can search the active profile and optionally merge results from selected profiles.

**Verification:**

- [ ] Unit tests for retrieval still pass.
- [ ] Manual check: index a small vault and ask a question against indexed notes.
- [ ] Manual check: reload Obsidian after indexing and query without reindexing.
- [ ] Build succeeds: `npm run build`.

**Dependencies:** Tasks 3, 4, and 5.

**Files likely touched:**

- `src/main.ts`
- `src/retrieval/RetrievalService.ts` only if any store-specific assumptions appear.
- `src/indexing/IndexProfileManager.ts`
- `tests/unit/retrieval-service.test.ts`

**Estimated scope:** Small.

### Task 7: Remove LanceDB from the Required Runtime Path

**Description:** Remove mandatory LanceDB imports, build externals, native package copy assumptions, and package dependencies after the pure JS store is active.

**Acceptance criteria:**

- [ ] `main.js` no longer contains unresolved `@lancedb/lancedb` imports.
- [ ] `package.json` no longer lists `@lancedb/lancedb` as a required dependency unless kept behind an explicit optional experiment.
- [ ] `esbuild.config.mjs` does not need LanceDB-specific external handling.
- [ ] Existing LanceDB files are removed or clearly isolated as non-runtime legacy code.
- [ ] README and spec no longer refer to LanceDB as the current storage backend.

**Verification:**

- [ ] `npm run build` succeeds.
- [ ] Search built `main.js` for `@lancedb/lancedb` and confirm no required runtime import remains.
- [ ] Plugin loads in Obsidian without module specifier errors.

**Dependencies:** Task 6.

**Files likely touched:**

- `package.json`
- `package-lock.json`
- `esbuild.config.mjs`
- `src/indexing/RealLanceDbDriver.ts`
- `src/indexing/LanceDbIndexStore.ts`
- `tests/unit/lancedb-index-store.test.ts`

**Estimated scope:** Medium.

## Phase 4: Migration and Cleanup

### Task 8: Handle Existing LanceDB Index Folders

**Description:** Decide how the plugin behaves for users who already have LanceDB files in the configured index folder.

**Acceptance criteria:**

- [ ] The plugin does not attempt to read LanceDB files as JSON.
- [ ] Existing LanceDB folders are ignored or moved aside safely.
- [ ] The index control marks the index as rebuild-needed when no file-backed manifest exists but legacy LanceDB artifacts are detected.
- [ ] Rebuild creates the new file-backed manifest, chunk metadata, and vector binary files.
- [ ] Migration creates a default index profile that points at the configured legacy index folder path, now labeled "Index folder".

**Verification:**

- [ ] Unit tests cover a folder containing unknown files.
- [ ] Manual check: existing `.ixplorer/index` LanceDB folder does not crash plugin load.

**Dependencies:** Task 7.

**Files likely touched:**

- `src/indexing/FileVectorIndexStore.ts`
- `src/indexing/IndexingController.ts`
- `tests/unit/file-vector-index-store.test.ts`

**Estimated scope:** Small.

### Task 9: Update Documentation and Manual Test Checklist

**Description:** Document the pure JS store behavior and remove native dependency expectations from project docs.

**Acceptance criteria:**

- [ ] README no longer implies LanceDB is required at runtime.
- [ ] README describes the index as vault-local file-backed storage, with metadata and vectors stored locally.
- [ ] Manual checklist includes indexing, clear, rebuild, plugin reload, search after reload, corrupt-index recovery, and search after changing embedding model.
- [ ] Release notes mention that users may need to rebuild the index after the storage backend change.
- [ ] Spec updates the confirmed decision from LanceDB to the file-backed pure JS store.

**Verification:**

- [ ] Documentation review for stale LanceDB references.
- [ ] Manual checklist is executable by a tester.

**Dependencies:** Tasks 6-8.

**Files likely touched:**

- `README.md`
- `docs/manual-test-checklist.md` if present or added.
- Optional release notes file.

**Estimated scope:** Small.

## Phase 5: Retrieval Features and Sync Resilience

### Task 10: Add Retrieval Filters and Score Thresholds

**Description:** Extend retrieval options to support score thresholds and optional source/file-extension filters without leaking storage details into research orchestration.

**Acceptance criteria:**

- [ ] Retrieval can request a `topK`/limit and optional minimum score threshold.
- [ ] Retrieval can filter by source kind or file extension where useful for UI controls and tests.
- [ ] Empty or over-strict filters return an empty result set without throwing.
- [ ] Default behavior remains unchanged for existing chat flows.

**Verification:**

- [ ] Unit tests cover score threshold filtering.
- [ ] Unit tests cover extension/source filtering.
- [ ] Full test suite passes: `npm test`.

**Dependencies:** Task 6.

**Files likely touched:**

- `src/shared/types.ts`
- `src/retrieval/RetrievalService.ts`
- `src/indexing/FileVectorIndexStore.ts`
- `tests/unit/retrieval-service.test.ts`
- `tests/unit/file-vector-index-store.test.ts`

**Estimated scope:** Small.

### Task 11: Add Lightweight Keyword Index

**Description:** Add a separate JSON/JSONL-backed inverted keyword index for fallback retrieval when semantic search is unavailable or when hybrid retrieval is requested.

**Acceptance criteria:**

- [ ] Keyword indexing builds posting files from stored chunk text during vector index writes.
- [ ] Keyword postings are sharded one-to-one with source-path hash vector shards.
- [ ] Tokenization is simple and deterministic: lowercase, punctuation splitting, and minimum token length.
- [ ] V1 uses only `minTokenLength` filtering; stop-word lists are deferred to a later release.
- [ ] Search returns ranked chunks using term coverage and frequency, with deterministic tie-breaking.
- [ ] Keyword fallback can run without calling the embedding provider.
- [ ] Corrupt or stale keyword posting files produce rebuild-needed or keyword-index-unavailable state without corrupting vector search.

**Verification:**

- [ ] Unit tests cover tokenization, posting generation, ranking, and empty queries.
- [ ] Unit tests cover keyword search after deleting or changing a source file.
- [ ] Unit tests cover corrupt keyword posting files.
- [ ] Manual check: stop the embedding provider and confirm keyword fallback can still return indexed chunks.

**Dependencies:** Tasks 1, 2, and 3.

**Files likely touched:**

- `src/indexing/LightweightKeywordIndex.ts`
- `src/retrieval/RetrievalService.ts`
- `src/shared/types.ts`
- `tests/unit/lightweight-keyword-index.test.ts`
- `tests/unit/retrieval-service.test.ts`

**Estimated scope:** Medium.

### Task 12: Add Resumable Sync Guardrails

**Description:** Add safeguards for large indexing runs so one big vault change does not monopolize the Obsidian UI or repeatedly redo failed work.

**Acceptance criteria:**

- [ ] Indexing has a configurable maximum changed-file batch per run or per event-loop slice.
- [ ] Files skipped because of the batch cap remain marked stale/deferred for the next run.
- [ ] Indexing errors for one extractable file do not discard already persisted chunks for unrelated files.
- [ ] Source snapshots in `sources.jsonl` survive plugin reloads and drive incremental skip decisions.
- [ ] Failed source snapshots can be recorded without pretending the source was successfully indexed.
- [ ] The state model can report deferred and failed file counts.
- [ ] A cancellation or pause request is checked before extraction, before embedding calls, and before persistence.

**Verification:**

- [ ] Unit tests cover deferred files across repeated indexing runs.
- [ ] Unit tests cover one failed file while other files persist.
- [ ] Manual check: pause during a long PDF/document indexing run responds promptly.

**Dependencies:** Task 6.

**Files likely touched:**

- `src/indexing/IndexingService.ts`
- `src/indexing/IndexingController.ts`
- `src/indexing/SourceSnapshotStore.ts`
- `src/shared/types.ts`
- `tests/unit/indexing-service.test.ts`
- `tests/unit/indexing-controller.test.ts`

**Estimated scope:** Medium.

## Checkpoints

### Checkpoint: Store Contract Ready

- [ ] File-backed format is versioned.
- [ ] `FileVectorIndexStore` passes contract tests.
- [ ] Missing and corrupt files are handled deliberately.
- [ ] Shard chunk metadata and vector binary lengths are validated together.
- [ ] `sources.jsonl` and keyword posting files are validated.

### Checkpoint: Plugin Uses Pure JS Store

- [ ] Indexing writes sharded chunk metadata, binary vectors, source snapshots, and keyword postings.
- [ ] Retrieval queries file-backed chunks after an Obsidian reload.
- [ ] Keyword fallback works after Obsidian reload without the embedding provider.
- [ ] At least two named index profiles can coexist with independent stale/refresh state.
- [ ] Full unit suite passes.
- [ ] Plugin builds cleanly.

### Checkpoint: LanceDB Removed from Runtime

- [ ] Built `main.js` contains no required `@lancedb/lancedb` import.
- [ ] Package dependencies no longer require native LanceDB.
- [ ] Obsidian loads the plugin without native package setup.

### Checkpoint: Release Candidate

- [ ] `npm run lint` passes.
- [ ] `npm test` passes.
- [ ] `npm run build` passes.
- [ ] Manual Obsidian checks pass on a clean plugin install.
- [ ] Manual Obsidian checks pass for reload, rebuild, clear, and embedding-model change.

## Risks and Mitigations

| Risk                                                        | Impact | Mitigation                                                                                                                                                | Status   |
| ----------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Linear scan becomes slow on large vaults.                   | Medium | Start with exact search over sharded vectors, add measured performance tests, tune shard count, and later introduce a pure JS ANN library only if needed. | Open     |
| Chunk metadata files become large.                          | Medium | Use source-path hash shards with JSONL metadata and shard-local `vectors.bin` files; tune shard count when measured write/query costs require it.         | Planned  |
| Corrupt index files break search.                           | Medium | Treat corrupt files as rebuild-needed with a clear error state and safe rebuild path.                                                                     | Planned  |
| Writes are interrupted.                                     | Medium | Write temp shard/source/keyword files first and publish `manifest.json` last; ignore incomplete temp files on load.                                       | Planned  |
| Embedding dimension mismatch causes confusing results.      | High   | Preserve strict metadata validation and return `INDEX_REBUILD_REQUIRED`.                                                                                  | Planned  |
| Migration from LanceDB loses old indexed data.              | Low    | Index data is derived from vault files; require rebuild rather than attempting native-to-JSON migration.                                                  | Accepted |
| Binary vector files and JSONL metadata drift apart.         | High   | Validate per-shard manifest chunk count, JSONL row count, vector byte length, and embedding dimensions before query.                                      | Planned  |
| Reindexing a large changed vault blocks Obsidian.           | Medium | Add changed-file caps, event-loop yields, pause/cancel checks, and deferred-file state.                                                                   | Planned  |
| Lightweight keyword search quality is weaker than FTS/BM25. | Medium | Keep tokenization simple for v1, add deterministic ranking tests, and consider FTS or SQLite only after v1 measurements.                                  | Accepted |
| Source snapshots become inconsistent with chunks.           | High   | Store `sources.jsonl` separately, validate source chunk counts against shard rows, and rebuild affected profiles when drift is detected.                  | Planned  |

## Recommended Initial Approach

Start with named index profiles. Inside each profile, use source-path hash sharding from day one with 32 shards by default: `manifest.json`, `sources.jsonl`, shard-local `*.chunks.jsonl`, shard-local `*.vectors.bin`, and one keyword posting file per vector shard. Use exact cosine similarity over normalized `Float32Array` vectors and atomic commit semantics that publish the manifest last. Keyword tokenization uses lowercase, punctuation splitting, and `minTokenLength` only; stop-word lists are deferred. Rename the user-facing storage setting to "Index folder" immediately, while preserving the existing persisted setting key until a later migration. `clear()` should fully remove the selected profile's manifest, sources, chunks, vectors, keyword postings, temp files, and cache. Keep Ixplorer's extractor-driven indexing pipeline instead of baking file-type logic into the store. Add full FTS/SQLite, SQLite WASM, adaptive sharding, term-hash keyword shards, stop-word lists, or ANN only after profiling real vault sizes shows a concrete need.
