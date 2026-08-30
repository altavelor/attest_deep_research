# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.3] - 2026-08-30

### Changed

- Plugin metadata uses the Community directory-compatible name `Attest AI Deep Research`.
- Mobile cloud-model responses are buffered through Obsidian's request API before display.

### Fixed

- Mobile cloud providers no longer depend on browser CORS headers for chat, capability probes,
  model discovery or embeddings.

## [0.4.2] - 2026-08-30

Improved onboarding, research reliability, diagnostics and source navigation.

### Added

- First-run setup wizard with localized onboarding and server presets, including readable
  model names for configured providers.
- Citable note reads, per-call sub-agent telemetry and aggregated sub-agent summaries in
  thinking diagnostics and reports.
- Clickable source registry links for web pages and local vault files, plus active-file
  attachments in chat.
- Provider and web-source guides, prompt evaluation cases and README demonstrations.

### Changed

- Thinking prompts are organized as explicit policy sections with capability-aware parallel
  calls, bounded tool results and bounded evidence.
- Research tool orchestration, citation verification and cancellation/error reporting are
  more defensive and preserve source provenance more reliably.
- Web search recovers results from DuckDuckGo anomaly pages.

### Fixed

- Source registry remains open while opening web or local source links, and local links open
  the corresponding vault files.
- The new-chat question field remains visible, composer controls use their final width, and
  interrupted chats are no longer all marked as interrupted in history.
- Untrusted sub-agent labels and prompt sections are escaped and bounded before use.

## [0.3.0] - 2026-08-29

Background chat sessions and faster access from Obsidian.

### Added

- Plugin-owned background chat sessions that persist their state, recover stale runs after
  restart and keep chat activity available independently of the active view.
- Attest commands for opening chat, asking about the current note or selected text, finding
  related notes, summarizing a note and updating the index, plus a ribbon action for opening
  chat.

## [0.2.0] - 2026-08-27

Mobile support, answers with images and charts, and a verifiable source registry.

### Added

- Obsidian Mobile support: the plugin no longer depends on Node APIs, and the index, chats
  and extractors run through a vault-relative file-system port with browser-safe sha256 and
  deflate helpers.
- Localized Obsidian UI with per-locale text direction.
- Answer artifacts: image galleries, charts and overflow-safe tables rendered in chat,
  exported to saved notes and restored when a saved chat is reopened.
- Image research: `search_images`, `present_image_gallery` and `present_chart` tools,
  Wikimedia Commons and Openverse resources, and candidate ranking by relevance. Search
  through general engines requires an explicit opt-in.
- Document images: a versioned index writes a document-image manifest, extracts candidates
  from vault documents and fetched pages, and includes images of documents read during a run.
- Conversation-wide hierarchical citation registry that binds citations to source revisions,
  with a sources popup and an export.
- Vault skill registry with default skills, lazy selection, diagnostics and mention
  autocomplete.
- Saved chat favorites and a new-chat defaults settings section.
- Streaming thinking timeline with fetch targets, animated site labels and reasoning trace
  in chat history.
- Per-answer diagnostics popover with a resizable report modal and answer citation
  diagnostics.
- Model capability discovery: provider metadata as evidence, role detection from
  provider-specific listings, advertised tool controls, and the reasoning-effort list
  advertised by OpenRouter.

### Changed

- The plugin is renamed from Ixplorer to Attest.
- Research modes are renamed eager → Instant and agentic → Thinking, moved into core, and
  exposed as a switch in chat.
- Instant mode is faster: the dead retrieve port is gone and the critical path is
  parallelized.
- Web research selects sources by intent relevance under a phase deadline, with selection
  tracing, parallel batch fetching and per-host throttling.
- Thinking mode renders citations like Instant, streams the final answer, and runs
  independent tool calls within a round in parallel.
- Web citation handles render as short clickable links.
- Settings, diagnostics, chat and composition modules are regrouped by responsibility;
  legacy index configuration and the standalone diagnostic panel are removed.
- Every message keeps its actions in one header row.

### Fixed

- A web-only research turn composes without a built index.
- An incomplete rebuild no longer reports the current index version, and a newly built index
  is marked as using the current layout.
- Deleted chat session state is preserved, and interrupted replaces found through listing
  are recovered; a backup is never deleted on a read path.
- Model provider errors and the provider response behind a failed embedding request are
  surfaced in chat.
- Capability status is scoped to the edited model and probes are cancelled reliably.
- Gallery object URLs are revoked on full transcript renders, and stale lightbox resolutions
  are dropped after close or navigation.
- PDF, EPUB and AVIF extraction handle flate rasters, spine-referenced images and AVIF
  dimensions correctly.

### Security

- Untrusted page text: hardened HTML stripping and entity decoding, escaped backslashes,
  quotes and image attribution, and no exponential backtracking in markdown cleanup.
- Image and page fetching: non-public IPv6 hosts are blocked, oversized provider responses
  are abandoned while reading, decoded images over the limit are rejected, and unsafe URLs
  in persisted answer images are rejected.
- Index manifest paths that escape the index folder are rejected, and the zlib checksum is
  verified when inflating.
- Secrets, embedded credential URLs and prefixed credential fields are redacted from logs
  and diagnostics.

### Known limitations

- No OCR for scanned PDFs or image-only pages.
- Web search fetches only the first result page of the configured provider.
- Deep Research (planned plan → gather → verify → synthesize → export mode) is not part of
  this release.

## [0.1.0] - 2026-08-08

First public release for Obsidian Desktop.

### Added

- Local-first research over the vault with hybrid retrieval: embeddings plus keyword search.
- Instant (eager) research flow for fast answers and for models without reasoning or tool calling.
- Thinking/Agentic research flow with multi-round tool calling for capability-compatible models,
  including a diagnosable fallback to the Instant flow.
- Ingestion of Markdown, TXT, PDF, EPUB, FB2, and DOCX documents.
- File-backed local index with manual runs, incremental refresh, pause/resume, and rebuild.
- Index profiles, server profiles, chat model profiles, and embedding model profiles.
- Chat providers: Anthropic, OpenAI-compatible endpoints (LM Studio, OpenRouter, vLLM), and Ollama.
- Optional web research through a configurable source catalog, academic sources, and page fetching;
  disabled by default.
- Verified citations with clickable links to files, pages, headings, and canonical URLs.
- Evidence registry, hierarchical summaries, claim index, and `map_sources` document comparison.
- Streaming answers, reasoning and tool traces, and a downloadable diagnostic report with
  redacted secrets.
- Saving an answer to a new note or appending it to the active note.

### Known limitations

- Desktop Obsidian only; mobile is not supported.
- No OCR for scanned PDFs or image-only pages.
- Web search fetches only the first result page of the configured provider.
- Deep Research (planned plan → gather → verify → synthesize → export mode) is not part of this
  release.

[unreleased]: https://github.com/altavelor/attest_deep_research/compare/0.4.3...HEAD
[0.4.3]: https://github.com/altavelor/attest_deep_research/compare/0.4.2...0.4.3
[0.4.2]: https://github.com/altavelor/attest_deep_research/compare/0.3.0...0.4.2
[0.3.0]: https://github.com/altavelor/attest_deep_research/compare/0.2.0...0.3.0
[0.2.0]: https://github.com/altavelor/attest_deep_research/compare/0.1.0...0.2.0
[0.1.0]: https://github.com/altavelor/attest_deep_research/releases/tag/0.1.0
