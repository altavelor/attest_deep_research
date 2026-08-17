# Attest

**Answers from your notes, backed by sources you can open.**

Attest turns your vault into something you can ask questions of. Instead of searching for the note
that might hold the answer, you ask in plain language — “What did we decide about pricing?” — and
get a written answer built from your own notes, where every claim is attested by the note, heading,
or document page it came from. One click takes you to the source.

You choose which folders it may read, and which AI model answers: a model running on your own
machine, or a cloud service you already use. Nothing leaves your vault unless you ask it to.

> **Obsidian 1.5.0+ on desktop · works with local models or cloud AI services**

## What you can do

- **Ask across a whole set of notes at once** — pick the folders that matter and leave the rest out.
- **Trust the answer** — each statement carries a citation you can open and read for yourself.
- **Pick the pace** — a quick answer for simple questions, or a slower mode that works through the
  question step by step and shows its progress.
- **Look beyond the vault** — optionally let a question reach the web when your notes are not enough.
- **Keep what is useful** — save an answer as a new note or add it to the note you are writing.
  Attest never changes a note on its own.

## Installation

Attest is not yet available in the Obsidian Community plugin catalog. When it is published,
install it through **Settings → Community plugins**, then enable it and open
**Settings → Attest**.

## Quick start: ask your first cited question

1. Create a **Server profile** for your chat and embedding provider.
2. Create a **Chat model profile** and select its server profile and model.
3. Create an **Embedding model profile**.
4. Create or select an **Index profile**, specify the vault folders to index, and choose the
   embedding model.
5. Start indexing and wait for the completed status.
6. Open Attest chat, select the index profile, and ask a question such as: _“What did we decide about pricing?”_
7. Open a citation in the answer to inspect the supporting note or document page.

If a step is unavailable, open the corresponding Settings section. Attest displays the status of
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
2. Enter the API key only in the Attest settings field.
3. Create separate chat and embedding profiles if the provider uses different models.

Use the test button in the profile settings to check the connection before the first indexing run.

### Recognised providers

Attest recognises a provider by the base URL of the Server profile and reads its model listing in
that provider's own format, so chat and embedding models are told apart automatically. Any other
OpenAI-compatible endpoint keeps working through the generic listing, where a model is treated as
an embedding model when its ID says so. A chat model whose ID contains `embed` is therefore offered
for the embedding role instead of the chat role; its name can still be typed into the model field
by hand.

| Provider                                                 | Base URL                                | API format          | How embedding models are detected                                    |
| -------------------------------------------------------- | --------------------------------------- | ------------------- | -------------------------------------------------------------------- |
| OpenRouter                                               | `https://openrouter.ai/api/v1`          | `openai-compatible` | `architecture.output_modalities`, plus a separate embeddings listing |
| DeepInfra                                                | `https://api.deepinfra.com/v1/openai`   | `openai-compatible` | `metadata.tags`                                                      |
| Together AI                                              | `https://api.together.xyz/v1`           | `openai-compatible` | model `type`                                                         |
| Mistral                                                  | `https://api.mistral.ai/v1`             | `openai-compatible` | `capabilities.completion_chat`                                       |
| OpenAI                                                   | `https://api.openai.com/v1`             | `openai-compatible` | model ID                                                             |
| Groq                                                     | `https://api.groq.com/openai/v1`        | `openai-compatible` | model ID                                                             |
| Fireworks AI                                             | `https://api.fireworks.ai/inference/v1` | `openai-compatible` | model ID                                                             |
| DeepSeek                                                 | `https://api.deepseek.com`              | `openai-compatible` | model ID                                                             |
| Cerebras                                                 | `https://api.cerebras.ai/v1`            | `openai-compatible` | model ID                                                             |
| Nebius AI Studio                                         | `https://api.studio.nebius.com/v1`      | `openai-compatible` | model ID                                                             |
| Novita AI                                                | `https://api.novita.ai/v3/openai`       | `openai-compatible` | model ID                                                             |
| LM Studio, vLLM, llama.cpp and other self-hosted servers | local URL                               | `openai-compatible` | model ID                                                             |
| Ollama                                                   | local URL                               | `ollama`            | every model is offered for both roles                                |
| Anthropic                                                | `https://api.anthropic.com/v1`          | `anthropic`         | chat only; embeddings are not supported                              |

The embedding profile is still verified with a real embedding request when it is saved, so a model
that the provider lists but cannot embed is suspended with an explanation.

## Indexing your vault

An Index profile determines which notes Attest can use as local sources.

- Choose the desired folders; `/` means the entire vault.
- Exclude system or private folders with glob patterns.
- Run a manual index for the first build.
- Use incremental refresh after note changes; rebuild recreates the local index.
- You can stop indexing and start it again later.

Attest supports Markdown, TXT, PDF, EPUB, FB2, and DOCX. Scanned PDFs without a text layer cannot
be read.

## Research modes

### Instant

A fast mode for local retrieval and models without tool calling or reasoning. Choose it when you
need a predictable short answer or when the model has not passed the capability check.

### Thinking

A multi-step mode for compatible models. It can search for additional sources and displays its
progress in chat. If the model does not support the required capabilities, Attest explains why
and falls back to Instant.

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

## Compatibility and limitations

| Requirement  | Details                                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------------------------- |
| Obsidian     | Desktop 1.5.0 or later; mobile is not supported.                                                           |
| Chat         | A configured local or cloud chat model is required.                                                        |
| Vault search | A configured embedding model and a completed index are required.                                           |
| Documents    | Markdown, TXT, PDF, EPUB, FB2, and DOCX are supported. Scanned PDFs without a text layer are not readable. |

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

## Help, development, and security

For development builds, project commands, architecture, and release requirements, see the
[Technical reference](docs/technical-reference.md). Report reproducible bugs in
[GitHub Issues](https://github.com/altavelor/attest_deep_research/issues), excluding API keys and
private notes. Report vulnerabilities through the [Security policy](SECURITY.md).

## Support the project

Attest is free and open source, built in spare time. If it saves you time, you can support further
work through [GitHub Sponsors](https://github.com/sponsors/altavelor),
[Buy Me a Coffee](https://buymeacoffee.com/altavelor), or [Boosty](https://boosty.to/altavelor).

Support is entirely optional and never unlocks features — every capability stays available to
everyone. Starring the repository, reporting a bug, or describing how you use Attest helps just as
much.

## License

Attest is available under the [MIT License](LICENSE).
