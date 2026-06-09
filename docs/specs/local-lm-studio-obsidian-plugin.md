# Spec: Ixplorer

## Assumptions

1. The plugin targets the Obsidian desktop app, not mobile, for the first release.
2. LM Studio runs locally and exposes an OpenAI-compatible HTTP API, usually at `http://localhost:1234/v1`.
3. The plugin should work without cloud model APIs. Optional cloud services may be added later only with explicit approval.
4. Vault indexing, embeddings, search state, and generated research notes stay local on the user's machine.
5. Web search is user-initiated and uses DuckDuckGo for the first implementation. SearXNG support should be added later through the same provider interface.
6. PDF and document ingestion should support large files incrementally instead of loading entire files into memory.
7. The first implementation should prioritize reliable retrieval and citations over autonomous multi-step agent behavior.
8. Ollama may be used as a local embeddings provider when the user chooses it.

## Objective

Build Ixplorer, an Obsidian plugin that lets a user run deep research across their vault, large local files, PDFs, and optional web search using local LM Studio chat models and local embeddings.

The primary user is a knowledge worker with a large Obsidian vault who wants private, local-first AI assistance. They should be able to ask questions, cite answers back to vault files or web pages, summarize long documents, and turn findings into Obsidian notes.

Primary user stories:

- As a user, I can connect the plugin to a local LM Studio model and verify that chat is available.
- As a user, I can use either LM Studio or Ollama local models for embeddings.
- As a user, I can index selected vault folders and supported attachment files for semantic retrieval.
- As a user, I can ask a question and receive an answer grounded in vault files, PDFs, and selected web results.
- As a user, I can see source citations that link back to Obsidian files, headings, blocks, PDF pages, or web URLs.
- As a user, I can create or append a research note containing the answer, citations, and follow-up questions.
- As a user, I can pause, resume, or rebuild indexing without corrupting the local index.

## Tech Stack

- Platform: Obsidian desktop plugin.
- Language: TypeScript.
- Runtime: Obsidian plugin API in Electron.
- Build tool: `esbuild`, following the standard Obsidian sample plugin pattern unless the scaffold chooses Vite for a clear reason.
- UI: Obsidian settings tab, chat pane, and status bar indicators. Command palette entries may open or focus the chat pane, but the first implementation does not need command-only research workflows.
- Local model API: LM Studio OpenAI-compatible endpoints for chat completions and optional embeddings.
- Local embeddings API: LM Studio or Ollama-compatible endpoint configured through an embedding provider base URL.
- Local index: pure JavaScript file-backed vector store behind an index adapter interface.
- Parsing:
  - Markdown: Obsidian vault APIs plus frontmatter-aware parsing.
  - PDF: incremental text extraction with page metadata.
  - Other documents: `.fb2`, `.epub`, `.txt`, and `.docx` extractors for first implementation indexing.
- Tests: TypeScript unit tests with a runner chosen during scaffold, likely Vitest.

## Commands

These commands define the expected project workflow after scaffolding:

```bash
npm install
npm run dev
npm run build
npm run test
npm run test -- --coverage
npm run lint
npm run format
```

Manual plugin install during development:

```bash
mkdir -p "<vault>/.obsidian/plugins/ixplorer"
cp main.js manifest.json styles.css "<vault>/.obsidian/plugins/ixplorer/"
```

Expected LM Studio health checks:

```bash
curl http://localhost:1234/v1/models
curl http://localhost:1234/v1/embeddings
```

Expected Ollama embeddings health check:

```bash
curl http://localhost:11434/api/tags
```

## Project Structure

```text
.
├── docs/
│   └── specs/
│       └── local-lm-studio-obsidian-plugin.md
├── src/
│   ├── main.ts                  # Obsidian plugin entry point
│   ├── settings/                # Settings schema, tab UI, persistence
│   ├── lmstudio/                # LM Studio client and model capability checks
│   ├── indexing/                # Index scheduler, chunking, change detection
│   ├── retrieval/               # Hybrid search, ranking, citation assembly
│   ├── extractors/              # Markdown, PDF, and document text extraction
│   ├── research/                # Research workflow orchestration
│   ├── ui/                      # Chat/research pane and status indicators
│   └── shared/                  # Types, errors, logging, utility functions
├── tests/
│   ├── unit/
│   └── fixtures/
├── manifest.json
├── package.json
├── tsconfig.json
└── esbuild.config.mjs
```

## Functional Requirements

### Local Model Connections

- Store configurable chat model provider base URL, chat model, embedding provider base URL, embedding model, request timeout, and context-size hints.
- Provide a "test connection" action that checks available models and reports actionable errors.
- Support streaming chat responses when LM Studio and the selected model allow it.
- Support LM Studio for chat completions.
- Support LM Studio and Ollama as local embedding providers.
- Fail gracefully when LM Studio or Ollama is closed, the model is unloaded, or embeddings are unavailable.

### Vault and File Indexing

- Index Markdown files from selected vault folders.
- Index `.pdf`, `.fb2`, `.epub`, `.txt`, and `.docx` files from selected vault folders.
- Exclude paths using configurable glob patterns.
- Track file modification time and content hash to avoid unnecessary re-indexing.
- Chunk content with source metadata: file path, heading trail, block ID when available, page number for PDFs, and character offsets where practical.
- Support manual reindex, background incremental index, pause, resume, and clear index.
- Display indexing progress and last indexed time.

### PDF and Similar Document Support

- Extract text from PDFs page by page and retain page-level citations.
- Handle large PDFs by streaming or batching extraction and embedding.
- Skip or mark image-only pages when OCR is not available.
- Provide extractor implementations for `.fb2`, `.epub`, `.txt`, and `.docx`.
- Keep extractors behind a shared interface so later formats can be added without changing retrieval logic.
- Ask before adding OCR or heavyweight native dependencies.

### Retrieval and Research

- Retrieve relevant chunks using semantic search and keyword fallback.
- Combine vault results, PDF results, and selected web results into a ranked evidence set.
- Generate answers that cite sources inline.
- Include a "sources used" section with links back to Obsidian files or URLs.
- Offer follow-up questions based on retrieved context.
- Allow the user to save the final research answer to a new note or append it to the active note.
- Do not persist intermediate research artifacts in the first implementation.

### Web Search

- Web search uses DuckDuckGo in the first implementation.
- Add SearXNG support later through a configurable search provider interface.
- DuckDuckGo search fetches only the first result in the first implementation.
- Search results must show URL, title, snippet, retrieval time, and whether full page content was fetched.
- Private vault content must never be sent to a web search provider.
- Web content must be stored separately from private vault embeddings unless the user explicitly saves it.

### Privacy and Safety

- All vault content, embeddings, and research outputs stay local unless the user explicitly initiates web search or exports content.
- Settings must make data flow clear: local LM Studio calls, external web search calls, and local index storage.
- Never log full note content, PDF text, or generated answers to the developer console by default.
- Provide a way to delete the local index.

## Non-Goals for First Release

- Obsidian mobile support.
- Cloud LLM providers.
- Autonomous browser control.
- Team/shared index synchronization.
- OCR for scanned PDFs unless explicitly approved.
- Editing user notes automatically without confirmation.
- Command-only research workflows.
- Persisting intermediate research artifacts.

## Documentation and Manual Verification

Development setup, local model configuration, DuckDuckGo behavior, privacy notes, and known limitations are documented in the repository [README](../../README.md).

Manual release validation is tracked in [docs/manual-test-checklist.md](../manual-test-checklist.md). The checklist covers settings, local model connection tests, indexing, retrieval, optional web search, saving answers, clearing the local index, and first-release limitations.

## Code Style

Use small TypeScript modules with explicit interfaces at subsystem boundaries. Prefer dependency injection for services that touch Obsidian APIs, local storage, network calls, and model calls so they can be tested independently.

Example style:

```ts
export interface RetrievedChunk {
  id: string;
  source: SourceReference;
  text: string;
  score: number;
}

export interface Retriever {
  search(query: string, options: RetrievalOptions): Promise<RetrievedChunk[]>;
}

export class ResearchService {
  constructor(
    private readonly retriever: Retriever,
    private readonly model: ChatModelProvider,
  ) {}

  async answer(question: string): Promise<ResearchAnswer> {
    const chunks = await this.retriever.search(question, { limit: 12 });
    return this.model.answerWithCitations(question, chunks);
  }
}
```

Conventions:

- Use `PascalCase` for classes, interfaces, and Obsidian views.
- Use `camelCase` for functions, variables, and settings keys.
- Use `kebab-case` for command IDs and CSS class suffixes.
- Keep network clients isolated from UI components.
- Represent recoverable failures with typed errors that can produce user-facing messages.
- Avoid global mutable state outside the plugin entry point and registered Obsidian lifecycle handles.

## Testing Strategy

- Unit test pure logic: chunking, path filtering, citation assembly, ranking, prompt construction, settings migration, and typed error mapping.
- Use fixtures for Markdown files, nested headings, block IDs, large synthetic files, and representative PDF extraction outputs.
- Mock LM Studio and web search clients with deterministic responses.
- Add integration-style tests for index update flows once storage is selected.
- Manual verification in Obsidian for plugin lifecycle, settings UI, command palette commands, chat/research view behavior, streaming responses, and saved notes.
- Target meaningful coverage of core research logic; UI tests can be thinner for the first release.

## Boundaries

- Always:
  - Keep vault data local by default.
  - Validate and normalize configured URLs before network calls.
  - Show citations for grounded answers.
  - Make indexing interruptible.
  - Keep long-running work off the UI thread where possible.
  - Run build and tests before considering implementation complete.
- Ask first:
  - Adding native dependencies.
  - Adding OCR.
  - Choosing a paid or cloud web search provider.
  - Sending vault-derived content to any external service.
  - Changing the storage engine after implementation begins.
  - Introducing telemetry or analytics.
- Never:
  - Commit secrets, API keys, or private vault content.
  - Send private vault content to web search.
  - Modify user notes without explicit confirmation.
  - Delete or rebuild an index without user action or a clear migration path.
  - Log full document contents by default.

## Success Criteria

- A user can install the plugin in Obsidian desktop and connect to LM Studio at a configurable local URL.
- The Obsidian plugin manifest identifies the plugin as `Ixplorer`.
- A user can choose LM Studio or Ollama for embeddings.
- A user can configure the vault-local folder where Ixplorer stores the file-backed local index.
- The plugin can index at least 1,000 Markdown notes and multiple large PDFs without freezing Obsidian.
- The plugin can index `.fb2`, `.epub`, `.txt`, and `.docx` files.
- A user can ask a vault question and receive an answer with clickable citations.
- A user can include the first DuckDuckGo result in a research query while keeping vault content private from the search provider.
- A user can save the final research answer into an Obsidian note with answer, citations, and timestamp.
- Indexing can be paused, resumed, cleared, and rebuilt from the settings UI.
- Build, lint, and test commands pass.
- Privacy-sensitive behavior is documented in settings or project documentation.

## Confirmed Decisions

1. DuckDuckGo is the first web search engine. SearXNG should be supported later.
2. The first required local vector storage engine is the pure JavaScript file-backed index. LanceDB-derived development indexes require a rebuild.
3. The first implementation requires only a chat pane.
4. First implementation indexing should support Markdown, PDF, `.fb2`, `.epub`, `.txt`, and `.docx`.
5. Embeddings should support both LM Studio and Ollama local models.
6. There are no minimum hardware requirements yet.
7. Research runs should persist only the final answer.
8. The plugin name is `Ixplorer`.
9. DuckDuckGo should fetch only the first result in the first implementation.
10. Ixplorer should store file-backed index data in a configurable vault-local folder.

## Remaining Open Questions

1. Which Ollama embedding model should be suggested as the default?
