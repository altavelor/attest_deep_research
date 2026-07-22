# Ixplorer

Local-first agentic research assistant for Obsidian desktop. Ixplorer indexes selected vault files into a vault-local file-backed vector index, retrieves cited evidence, and streams answers from a local or cloud chat model. It supports multi-round agentic tool calling (search vault, search web, browse vault structure, mutate notes), extended-thinking via the OpenAI responses protocol, multi-provider LLM backends (Anthropic, OpenAI-compatible, Ollama), and optional DuckDuckGo web search.

## Quick Start

1. Install dependencies:

   ```bash
   npm install
   ```

2. Build the plugin. Output goes to `dist/` inside the repository:

   ```bash
   npm run build
   ```

3. Link the build into a development Obsidian vault. Symlink the three build
   artifacts individually so Obsidian keeps writing plugin settings
   (`data.json`) into the vault rather than into the repository:

   ```bash
   VAULT="<vault>/.obsidian/plugins/ixplorer"
   mkdir -p "$VAULT"
   for f in main.js manifest.json styles.css; do
     ln -sf "$(pwd)/dist/$f" "$VAULT/$f"
   done
   ```

   With the symlinks in place, `npm run dev` rebuilds straight into the vault.
   Alternatively, set `IXPLORER_OUTPUT_DIR` to build directly into a vault path.

4. Enable `Ixplorer` from Obsidian Settings → Community plugins.

5. Open Settings → Ixplorer and configure server profiles and model profiles.

## Commands

| Command             | Description                                  |
| ------------------- | -------------------------------------------- |
| `npm run dev`       | Build in watch mode.                         |
| `npm run build`     | Type-check and create production `main.js`.  |
| `npm run styles`    | Build `styles.css` from colocated CSS files. |
| `npm test`          | Run the Vitest suite.                        |
| `npm run typecheck` | Run TypeScript with `--noEmit`.              |
| `npm run format`    | Check Prettier formatting.                   |

Styles are colocated next to their UI owners under `src/apps/obsidian/ui/`. `src/apps/obsidian/styles.json` defines the artifact order. The Obsidian-facing `styles.css` is generated only in the plugin output directory during `npm run dev` / `npm run build`.

## Settings

### Server Profiles

Each server profile defines an LLM or embedding endpoint.

| Setting    | Notes                                                                                 |
| ---------- | ------------------------------------------------------------------------------------- |
| Base URL   | API root (e.g. `http://localhost:1234/v1`).                                           |
| API key    | Optional. Required for cloud providers.                                               |
| API format | `openai-compatible`, `anthropic`, or `ollama`. Controls request/response wire format. |

### Chat Model Profiles

| Setting          | Notes                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| Model name       | Model ID as reported by the server.                                                                  |
| Temperature      | Sampling temperature.                                                                                |
| Max tokens       | Output token limit.                                                                                  |
| Tool calling     | `probe` (auto-detect), `native`, `text-based`, or `disabled`.                                        |
| Reasoning        | `none`, `chat-completions` (inline), or `responses` (OpenAI responses protocol / extended thinking). |
| Reasoning effort | `low`, `medium`, or `high`. Only used with the responses protocol.                                   |
| Note mutations   | Allow the model to create, update, or delete vault notes during agentic research.                    |

### Embedding Model Profiles

| Setting        | Notes                                         |
| -------------- | --------------------------------------------- |
| Server profile | Which server to call for embeddings.          |
| Model name     | Embedding model ID (e.g. `nomic-embed-text`). |

### Index Profiles

Up to 30 independent indexes can be configured.

| Setting          | Default                                     | Notes                                                 |
| ---------------- | ------------------------------------------- | ----------------------------------------------------- |
| Included folders | `/`                                         | One vault folder per line. `/` means the whole vault. |
| Excluded globs   | `.obsidian/**`, `.trash/**`, `.ixplorer/**` | One glob pattern per line.                            |
| Index folder     | `.ixplorer/index`                           | Vault-local storage path.                             |
| Chunk size       | 512 tokens                                  | Tokens per text chunk.                                |
| Chunk overlap    | 64 tokens                                   | Overlap between adjacent chunks.                      |
| PDF chunk size   | 1024 tokens                                 | Separate chunk size for PDF pages.                    |
| Embedding batch  | 32                                          | Chunks per embedding API call.                        |
| Keyword indexing | enabled                                     | Full-text keyword fallback for semantic search.       |
| Shard count      | 4                                           | Number of vector shards (affects memory usage).       |
| Refresh mode     | manual                                      | `manual` or `automatic`.                              |

### Global Settings

| Setting                  | Default  | Notes                                                                                 |
| ------------------------ | -------- | ------------------------------------------------------------------------------------- |
| DuckDuckGo web search    | disabled | External search is opt-in and user-initiated.                                         |
| Linked notes context     | disabled | Include backlinks and forward links in chat context.                                  |
| Graph depth              | 1        | Hop depth for linked notes (1 or 2).                                                  |
| Active file context      | disabled | Automatically include the currently open note.                                        |
| Filter context expansion | disabled | Expand context through linked notes matching the search filter.                       |
| Eager research           | disabled | Force research even when vault evidence appears fresh; bypasses freshness heuristics. |
| Debug mode               | disabled | Emit verbose logs.                                                                    |

## Supported Chat Providers

### Anthropic

Use the official Anthropic API or a compatible endpoint.

| Setting    | Value                       |
| ---------- | --------------------------- |
| Base URL   | `https://api.anthropic.com` |
| API key    | Your Anthropic API key.     |
| API format | `anthropic`                 |

Extended thinking is supported via the `responses` reasoning mode on capable models (e.g. `claude-opus-4-5`, `claude-sonnet-4-5`).

### OpenAI-Compatible (LM Studio, OpenRouter, vLLM)

Ixplorer defaults to LM Studio's OpenAI-compatible API at `http://localhost:1234/v1`.

1. Start LM Studio and load a chat-capable model.
2. Start the local server.
3. In Ixplorer settings create a server profile with base URL `http://localhost:1234/v1` and format `openai-compatible`.
4. Set the model name to the ID shown by LM Studio.
5. Use the settings tab's chat connection test.

```bash
curl http://localhost:1234/v1/models
```

### Ollama (Chat and Embeddings)

1. Start Ollama.
2. Pull a model:

   ```bash
   ollama pull llama3
   ollama pull nomic-embed-text
   ```

3. Create a server profile with base URL `http://localhost:11434` and format `ollama`.
4. Assign it to a chat model profile and/or an embedding model profile.

```bash
curl http://localhost:11434/api/tags
```

## Agentic Research

When deep research is enabled in the chat pane, Ixplorer runs a multi-round tool-calling loop before synthesising an answer. The model may call any combination of the following tools across multiple rounds:

| Tool           | Description                                                            |
| -------------- | ---------------------------------------------------------------------- |
| `search_index` | Semantic search over the vault vector index (1–5 results per call).    |
| `search_web`   | DuckDuckGo web search (requires web search to be enabled in settings). |
| `list_notes`   | Browse vault folder structure.                                         |
| `create_note`  | Create a new vault note (requires note mutations to be enabled).       |
| `update_note`  | Update an existing vault note (requires note mutations to be enabled). |
| `delete_note`  | Delete a vault note (requires note mutations to be enabled).           |

Note mutations are disabled by default and must be explicitly enabled per chat model profile.

## Extended Thinking

When the chat model profile uses the `responses` reasoning mode, Ixplorer sends requests via the OpenAI responses protocol and surfaces the model's reasoning chain alongside the answer. Reasoning effort (`low` / `medium` / `high`) controls how much compute the model spends on the thinking step.

Extended thinking is currently available on Anthropic models that support the responses protocol. Tool capability and reasoning format can be auto-probed by Ixplorer and cached per model.

## Supported Document Formats

The vector index ingests the following formats:

| Format        | Extension |
| ------------- | --------- |
| Markdown      | `.md`     |
| Plain text    | `.txt`    |
| PDF           | `.pdf`    |
| EPUB          | `.epub`   |
| FictionBook   | `.fb2`    |
| Word document | `.docx`   |

## DuckDuckGo Behavior

DuckDuckGo search is disabled by default. When enabled and selected in the chat pane, Ixplorer sends only the typed user question to DuckDuckGo, fetches only the first result page, and uses that page as separate web evidence. Retrieved vault chunks, PDF text, document text, embeddings, and generated answers are not sent to DuckDuckGo.

## Privacy Notes

- Vault content, embeddings, chunk metadata, keyword postings, and vector files stay local by default.
- Chat and embedding calls go only to the configured endpoints (local or cloud, as configured).
- DuckDuckGo is external, disabled by default, and receives only the user query when the user opts in.
- Ixplorer does not log full note, PDF, document, or generated answer content by default.
- Saved answers are written only when the user clicks a save action in the chat pane.

## Diagnostics

The chat toolbar includes a diagnostic report button. The V3 report captures:

- Model and server profile in use.
- Tool capability probe results.
- Request/response metadata for the research and synthesis steps.
- Reasoning chain state.
- Evidence retrieved (sources, chunk counts, token budget).
- Tool call trace (each round, each call, each result).
- Fallback reasons and loop-termination signals.

Reports can be viewed in readable or raw JSON format and downloaded to disk.

## Manual Testing

Use [docs/manual-test-checklist.md](docs/manual-test-checklist.md) before a development release. It covers settings, model connectivity, indexing, retrieval, web search, saving answers, and clearing the local index.

## GitHub Task Automation

Issue-driven tasks are implemented, published, and reviewed through a set of
scripts in [`scripts/`](scripts/) that drive an AI coding agent via the GitHub
CLI. The flow is **CLI-neutral**: the agent command and the review trigger are
configuration, so Codex, Claude Code, Aider, or any other CLI can be plugged in.

Lifecycle: GitHub issue → task branch + implementation → validation → draft PR →
independent AI review → local fix loop → human merge.

### Prerequisites

- [`gh`](https://cli.github.com/) authenticated (`gh auth login`), plus `git`,
  `jq`, `npm`, and your chosen agent CLI on `PATH`.
- Labels created once per repository: `scripts/setup-labels.sh`.
- For AI review, the review integration configured on the repository (e.g. the
  Codex GitHub App with Code review enabled at
  [chatgpt.com/codex](https://chatgpt.com/codex)).

### Configuration — `scripts/agent.env`

The scripts source [`scripts/agent.env`](scripts/agent.env); every value can also
be overridden through the environment. Key settings:

| Variable         | Purpose                                                                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BASE_BRANCH`    | Branch task branches are created from and reviewed against (default `main`).                                                                                                                |
| `AGENT_EXEC_CMD` | Command that runs the agent on a prompt read from STDIN. Examples: `codex exec -`, `claude -p`, `aider --message-file -`.                                                                   |
| `REVIEW_TRIGGER` | PR comment that triggers the AI review, e.g. `@codex review`.                                                                                                                               |
| `REVIEW_SOURCE`  | How the fix loop decides pass/fail: `comments` (built-in review posted on the PR — no repo key, uses your review subscription) or `check` (a CI status check — deterministic, needs a key). |

Fix-loop tuning: `MAX_REVIEW_ITERS`, `REVIEW_POLL_INTERVAL`,
`REVIEW_POLL_TIMEOUT`, and (in `check` mode) `REVIEW_CHECK_NAME`.

### Usage

```bash
# 1. Create a structured task (uses .github/ISSUE_TEMPLATE/agent-task.yml)
gh issue create --template agent-task.yml

# 2. Implement + publish: create the task branch, run the agent on a normalized
#    prompt, commit its work, validate (npm run check), push, and open a draft
#    PR linked to the issue. No review is requested here.
scripts/agent-task.sh <issue-number>

# 3. Review loop: request an independent AI review, then on failure feed the
#    findings (and any fixes the reviewer pushed itself) to the agent,
#    re-validate, push, and re-request review until it passes
scripts/review-loop.sh <issue-number>
```

Merge stays a human decision; the scripts never merge.

### Creating a task issue

The issue is the contract the agent works from, so treat it as a specification
rather than a one-line command. A good issue states **what** to achieve and
**how success is verified**, and bounds **where** changes may happen. It should
cover the same fields the issue form asks for:

- **Goal** — the outcome to achieve.
- **Context** — why it is needed.
- **Acceptance criteria** — a checklist of verifiable conditions.
- **Allowed scope** — files or modules that may change.
- **Out of scope** — changes that must not be made.
- **Risks and constraints** — compatibility, security, or architectural limits.
- **Validation commands** — usually `npm run check`.

The `type:*` label sets the branch prefix (`type:bug` → `fix/…`,
`type:feature` → `feat/…`, `type:refactor` → `refactor/…`, otherwise `chore/…`),
and `status:ready` marks it available to pick up.

**Option A — interactive form.** Fills the fields through the GitHub template
[`.github/ISSUE_TEMPLATE/agent-task.yml`](.github/ISSUE_TEMPLATE/agent-task.yml):

```bash
gh issue create --template agent-task.yml
```

**Option B — from a specification file.** Write the task once as a Markdown
spec and pass it with `--body-file`. This keeps the spec reviewable in git and
reproducible, and is the better fit for larger tasks:

```bash
# .github/tasks/search-duplicates.md  (any path works; keeping specs in the
# repo makes them reviewable and reusable)
gh issue create \
  --title "fix(search): prevent duplicate research results" \
  --label "agent,status:ready,type:bug,risk:medium" \
  --assignee "@me" \
  --body-file .github/tasks/search-duplicates.md
```

A spec file mirrors the form fields, for example:

```md
## Goal

Prevent duplicate results when the same source is retrieved by both vault and
web search in one research round.

## Context

Users see the same note or page twice in the evidence list, which inflates the
token budget and confuses citations.

## Acceptance criteria

- [ ] Evidence is de-duplicated by normalized source identity before synthesis.
- [ ] Vault and web hits for the same URL collapse into one cited source.
- [ ] A regression test covers a round that retrieves one source twice.

## Allowed scope

- `src/application/research/`
- `tests/`

## Out of scope

- Ranking or scoring changes.
- Any UI changes.

## Risks and constraints

- Must not drop distinct sources that merely share a title.
- Preserve existing citation numbering behavior.

## Validation commands

npm run check
```

Once the issue exists, note its number and continue with `scripts/agent-task.sh
<issue-number>`. To pick up an already-filed task, list what is ready:

```bash
gh issue list --label "agent,status:ready" --state open \
  --json number,title,url
```

### Review sources

- **`comments` (keyless).** The loop posts `REVIEW_TRIGGER` and polls the PR's
  review comments. A fresh review with new inline findings counts as a failure;
  one without them counts as a pass. The heuristic depends on how the reviewer
  formats output and may need tuning. Note the built-in reviewer may skip draft
  PRs (use `gh pr ready`) and may push its own fix commits — the loop pulls those
  in before running the local fixer.
- **`check` (deterministic).** Enable the optional blocking gate by renaming
  [`.github/workflows/agent-review.yml.example`](.github/workflows/agent-review.yml.example)
  to `agent-review.yml`, adding the API-key secret it documents, and marking the
  `agent-review` status check required in a branch ruleset. The workflow emits
  `VERDICT: PASS` / `VERDICT: FAIL`, and the loop reads that check.

## Known Limitations

- Desktop Obsidian only; mobile is not supported.
- No OCR for scanned PDFs or image-only pages.
- SearXNG is planned for later; DuckDuckGo is the only web search provider in the first release.
- Web search fetches only the first DuckDuckGo result page.
- After upgrading from a LanceDB-backed development build, rebuild the local index so Ixplorer creates the new file-backed manifest, source snapshots, chunk metadata, keyword postings, and vector files.
