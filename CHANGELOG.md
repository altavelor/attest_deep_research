# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[unreleased]: https://github.com/altavelor/ixplorer_deep_research/compare/0.1.0...HEAD
[0.1.0]: https://github.com/altavelor/ixplorer_deep_research/releases/tag/0.1.0
