# Ixplorer

Ixplorer is a local-first research assistant for Obsidian Desktop. It searches a selected part of
your vault, produces answers with citations, and can use configured web search when needed.

Technical documentation for development, builds, and releases is available in the
[Technical reference](docs/technical-reference.md).

## Before you begin

- Ixplorer runs in Obsidian Desktop. Mobile applications are not yet supported.
- Chat requires a local or cloud LLM provider.
- Vault search requires an embedding model.
- Cloud providers require your API key; local Ollama and LM Studio can work without one.

## Installation

Install Ixplorer through **Settings → Community plugins** in Obsidian when the plugin is available
in the catalog. Then enable it and open **Settings → Ixplorer**.

## Quick start

1. Create a **Server profile** for your chat and embeddings provider.
2. Create a **Chat model profile** and select its server profile and model.
3. Create an **Embedding model profile**.
4. Create or select an **Index profile**, specify the vault folders to index, and choose the
   embedding model.
5. Start indexing and wait for the completed status.
6. Open Ixplorer chat, select the index profile, and ask a question.

If a step is unavailable, open the corresponding Settings section. Ixplorer displays the status of
each model and index profile.

## Configuring providers

### Ollama

1. Start Ollama and download chat and embedding models.
2. In the Server profile, select the `ollama` format and enter the Ollama address.
3. Create chat and embedding profiles using that server profile.

### LM Studio and other OpenAI-compatible providers

1. Start a compatible server and load a chat model.
2. In the Server profile, select the `openai-compatible` format.
3. Enter the URL and API key if the provider requires one.
4. Select the model ID reported by the server.

### Anthropic and other cloud providers

1. Create a Server profile with the appropriate API format and endpoint.
2. Enter the API key only in the Ixplorer settings field.
3. Create separate chat and embedding profiles if the provider uses different models.

Use the test button in the profile settings to check the connection before the first indexing run.

## Indexing your vault

An Index profile determines which notes Ixplorer can use as local sources.

- Choose the desired folders; `/` means the entire vault.
- Exclude system or private folders with glob patterns.
- Run a manual index for the first build.
- Use incremental refresh after note changes; rebuild recreates the local index.
- You can stop indexing and start it again later.

Ixplorer supports Markdown, TXT, PDF, EPUB, FB2, and DOCX. OCR is not yet available for scanned
PDFs without a text layer.

## Research modes

### Instant

A fast mode for local retrieval and models without tool calling or reasoning. Choose it when you
need a predictable short answer or when the model has not passed the capability check.

### Thinking

A multi-step mode for compatible models. It can search for additional sources and displays its
progress in chat. If the model does not support the required capabilities, Ixplorer explains why
and falls back to Instant.

Deep Research is a future standalone mode and is not part of the current stable user flow.

## Working with answers

- Ask a question in chat and, if needed, choose the index-only, index-and-web, or web-only scope.
- Open citations to go to the note, heading, PDF page, or canonical web URL.
- Unknown and unverified citations appear as warnings.
- Save an answer as a new note or append it to the active note. An existing file is not overwritten
  without an explicit action.

## Web search and privacy

Web search is disabled by default. When enabled, the external search provider receives only the
entered question; retrieved vault content and embeddings are not sent to it. Chat and embedding
providers receive only the data needed for the user-selected request.

Note mutations are disabled by default. Enable them only for a model and vault you trust.

## Diagnostics and troubleshooting

The diagnostic report in the toolbar helps with provider, index, or research-flow problems. Before
sending a report, make sure it contains no private notes, and never attach an API key.

| Problem                | What to do                                                             |
| ---------------------- | ---------------------------------------------------------------------- |
| Chat model unavailable | Check the URL, API key, and model ID, then run the connection test.    |
| Empty index            | Choose an embedding profile, check included folders, and run indexing. |
| Thinking unavailable   | Recheck model capabilities or choose Instant.                          |
| Web request failed     | Disable web search for a vault-only answer or check source settings.   |
| Citation does not open | Make sure the source file has not been deleted or moved.               |

Report vulnerabilities under the [Security policy](SECURITY.md), and reproducible bugs through
GitHub Issues with a diagnostic report that excludes secrets and private content.

## Limitations

- Obsidian Desktop only.
- No OCR for scanned PDFs or analysis of images and charts.
- Web search uses only configured sources and can be disabled completely.
- Deep Research, resumable queues, and a standalone report exporter are not yet available.
