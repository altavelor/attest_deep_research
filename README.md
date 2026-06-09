# Ixplorer

Local-first research assistant for Obsidian desktop. Ixplorer indexes selected vault files into a vault-local file-backed vector index, retrieves cited evidence, streams answers from a local LM Studio or Ollama-compatible chat model, and can optionally fetch the first DuckDuckGo result for a user-initiated web query.

## Quick Start

1. Install dependencies:

   ```bash
   npm install
   ```

2. Build the plugin:

   ```bash
   npm run build
   ```

3. Create a development plugin folder in a desktop Obsidian vault:

   ```bash
   mkdir -p "<vault>/.obsidian/plugins/ixplorer"
   cp main.js manifest.json styles.css "<vault>/.obsidian/plugins/ixplorer/"
   ```

4. Enable `Ixplorer` from Obsidian Settings -> Community plugins.

5. Open Settings -> Ixplorer and configure local model endpoints.

## Commands

| Command          | Description                                 |
| ---------------- | ------------------------------------------- |
| `npm run dev`    | Build in watch mode.                        |
| `npm run build`  | Type-check and create production `main.js`. |
| `npm test`       | Run the Vitest suite.                       |
| `npm run lint`   | Run TypeScript with `--noEmit`.             |
| `npm run format` | Check Prettier formatting.                  |

## Settings

| Setting                     | Default                                     | Notes                                                      |
| --------------------------- | ------------------------------------------- | ---------------------------------------------------------- |
| Chat provider base URL      | `http://localhost:1234/v1`                  | Local LM Studio or Ollama chat endpoint.                   |
| Chat model                  | empty                                       | Set this to the loaded local chat model name.              |
| Embedding provider base URL | `http://localhost:11434`                    | Local LM Studio or Ollama embedding endpoint.              |
| Embedding model             | empty                                       | Set this to the embedding model available at the endpoint. |
| Index folder                | `.ixplorer/index`                           | Vault-local file-backed vector index storage.              |
| Included folders            | `/`                                         | One vault folder per line. `/` means the whole vault.      |
| Excluded globs              | `.obsidian/**`, `.trash/**`, `.ixplorer/**` | One glob pattern per line.                                 |
| DuckDuckGo                  | disabled                                    | External search is opt-in and user-initiated.              |

## LM Studio Chat

Ixplorer defaults to LM Studio's OpenAI-compatible API at `http://localhost:1234/v1`.

1. Start LM Studio.
2. Load a chat-capable model.
3. Start the local server.
4. In Ixplorer settings, set the chat provider base URL to `http://localhost:1234/v1`.
5. Set the chat model name to the model ID shown by LM Studio.
6. Use the settings tab's chat connection test.

Useful check:

```bash
curl http://localhost:1234/v1/models
```

## Ollama Embeddings

Ixplorer can use Ollama for local embeddings. The default embedding endpoint is `http://localhost:11434`, which Ixplorer normalizes to Ollama's `/api` routes internally.

1. Start Ollama.
2. Pull an embedding model, for example:

   ```bash
   ollama pull nomic-embed-text
   ```

3. Set the embedding provider base URL to `http://localhost:11434`.
4. Set the embedding model to the installed model name.
5. Use the settings tab's embedding connection test.

Useful check:

```bash
curl http://localhost:11434/api/tags
```

## DuckDuckGo Behavior

DuckDuckGo search is disabled by default. When enabled and selected in the chat pane, Ixplorer sends only the typed user question to DuckDuckGo, fetches only the first result page, and uses that page as separate web evidence. Retrieved vault chunks, PDF text, document text, embeddings, and generated answers are not sent to DuckDuckGo.

## Privacy Notes

- Vault content, embeddings, chunk metadata, keyword postings, and vector files stay local by default.
- Local chat and embedding calls go only to the configured local endpoints.
- DuckDuckGo is external, disabled by default, and receives only the user query when the user opts in.
- Ixplorer does not log full note, PDF, document, or generated answer content by default.
- Saved answers are written only when the user clicks a save action in the chat pane.

## Manual Testing

Use [docs/manual-test-checklist.md](docs/manual-test-checklist.md) before a development release. It covers settings, model connectivity, indexing, retrieval, web search, saving answers, and clearing the local index.

## Known Limitations

- Desktop Obsidian only; mobile is not supported.
- No OCR for scanned PDFs or image-only pages.
- SearXNG is planned for later; DuckDuckGo is the only web search provider in the first release.
- Web search fetches only the first DuckDuckGo result.
- Cloud LLM providers are not supported in the first release.
- After upgrading from a LanceDB-backed development build, rebuild the local index so Ixplorer creates the new file-backed manifest, source snapshots, chunk metadata, keyword postings, and vector files.
