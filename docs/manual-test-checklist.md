# Ixplorer Manual Test Checklist

Use this checklist before a development release. Record the Obsidian version, operating system, local model runtime, and model names used for the run.

## Environment

- [ ] Obsidian desktop is installed and starts normally.
- [ ] Ixplorer is built with `npm run build`.
- [ ] `main.js`, `manifest.json`, and `styles.css` are copied into `<vault>/.obsidian/plugins/ixplorer/`.
- [ ] Ixplorer is enabled from Obsidian Settings -> Community plugins.
- [ ] The Ixplorer settings tab opens without console errors.

## Settings

- [ ] Chat provider base URL defaults to `http://localhost:1234/v1`.
- [ ] Embedding provider base URL defaults to `http://localhost:11434`.
- [ ] Index folder defaults to `.ixplorer/index`.
- [ ] Included folders default to `/`.
- [ ] Excluded globs include `.obsidian/**`, `.trash/**`, and `.ixplorer/**`.
- [ ] DuckDuckGo is disabled by default.
- [ ] Settings persist after closing and reopening Obsidian.

## LM Studio Chat

- [ ] LM Studio is running with a chat model loaded.
- [ ] `curl http://localhost:1234/v1/models` returns the loaded model.
- [ ] Ixplorer chat provider base URL is set to `http://localhost:1234/v1`.
- [ ] Chat model is set to the loaded model ID.
- [ ] The Ixplorer settings chat connection test succeeds.
- [ ] A stopped LM Studio server produces a concise user-facing failure notice.

## Ollama Embeddings

- [ ] Ollama is running.
- [ ] `curl http://localhost:11434/api/tags` returns the embedding model.
- [ ] Ixplorer embedding provider base URL is set to `http://localhost:11434`.
- [ ] Embedding model is set to an installed embedding model.
- [ ] The Ixplorer settings embedding connection test succeeds.
- [ ] A stopped Ollama server produces a concise user-facing failure notice.

## Indexing

- [ ] Configure included folders to a small test folder with Markdown, PDF, `.txt`, `.docx`, `.epub`, and `.fb2` fixtures.
- [ ] Run manual indexing from the available indexing control.
- [ ] Indexing progress updates while files are scanned and embedded.
- [ ] File-backed index files are created under the configured vault-local folder: `manifest.json`, `sources.jsonl`, `shards/*.chunks.jsonl`, `shards/*.vectors.bin`, and `keywords/*.terms.jsonl`.
- [ ] Unchanged files are skipped on a second indexing run.
- [ ] Reload Obsidian and run indexing again; unchanged files are skipped from `sources.jsonl` snapshots.
- [ ] Pause responds during a long indexing run.
- [ ] Resume continues after a paused run.
- [ ] Clear index removes local indexed chunks and resets visible indexing state.
- [ ] Rebuild clears the previous index and creates fresh chunks.
- [ ] A folder containing legacy or unknown non-manifest index files shows rebuild-needed behavior instead of crashing plugin load.
- [ ] Changing the embedding model produces rebuild-needed behavior until the index is rebuilt.

## Retrieval and Chat

- [ ] Run the command palette command `Open Ixplorer chat`.
- [ ] Ask a question that should match an indexed Markdown note.
- [ ] The answer streams into the chat pane.
- [ ] Local citations appear under Sources.
- [ ] Clicking a Markdown citation opens the referenced note.
- [ ] Ask a question that should match a PDF.
- [ ] PDF citations include page numbers and open the referenced PDF target.
- [ ] Follow-up question buttons copy the follow-up into the question input.
- [ ] Stop the embedding provider and ask a keyword-heavy question; keyword fallback can return indexed chunks without calling embeddings.

## Web Search

- [ ] With DuckDuckGo disabled, the web toggle is disabled in the chat pane.
- [ ] Enable DuckDuckGo in settings.
- [ ] Ask a question with the web toggle enabled.
- [ ] The answer includes at most one web result citation.
- [ ] The web citation opens the result URL in the browser.
- [ ] Confirm no vault text is included in the DuckDuckGo request, using a local proxy or network inspector if available.

## Saving Answers

- [ ] After a completed answer, click `New note`.
- [ ] A note is created under `Ixplorer/YYYY-MM-DD-question-slug.md`.
- [ ] The saved note renders timestamp, question, answer, citations, and follow-up questions.
- [ ] Open a normal Markdown note and make it active.
- [ ] Click `Append active` from the chat pane.
- [ ] The active note receives the final answer block with timestamp, question, answer, citations, and follow-up questions.
- [ ] If no active note is open, append shows a clear notice and does not create a hidden write.

## Clearing and Privacy

- [ ] Clear index removes the configured local index data.
- [ ] DuckDuckGo remains disabled after clearing the index unless explicitly enabled.
- [ ] No full note, PDF, document, or generated answer content appears in the developer console during normal use.
- [ ] Saved answers are written only after clicking `New note` or `Append active`.

## Known Limitations to Confirm

- [ ] Obsidian mobile is not supported.
- [ ] OCR is not available for scanned PDFs or image-only pages.
- [ ] SearXNG is not available yet.
- [ ] DuckDuckGo fetches only the first result.
