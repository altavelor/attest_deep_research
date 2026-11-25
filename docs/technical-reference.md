# Technical reference

This document is for contributors and maintainers. End-user setup and usage are documented in the
[README](../README.md).

## Development build

Install dependencies and produce the plugin artifacts:

```bash
npm install
npm run build
```

The build output is `dist/main.js`, `dist/manifest.json`, and `dist/styles.css`. To use a local
development build in an Obsidian vault, link these three artifacts into
`.obsidian/plugins/attest/`. `npm run dev` rebuilds in watch mode; alternatively set
`ATTEST_OUTPUT_DIR` to an explicit plugin directory.

## Project commands

| Command                 | Purpose                                                     |
| ----------------------- | ----------------------------------------------------------- |
| `npm run dev`           | Watch-mode development build.                               |
| `npm run build`         | Type-check and create production artifacts.                 |
| `npm test`              | Run the Vitest suite.                                       |
| `npm run typecheck`     | Run TypeScript without emitting files.                      |
| `npm run depcruise`     | Check dependency boundaries.                                |
| `npm run format`        | Check Prettier formatting.                                  |
| `npm run check`         | Run the complete quality gate.                              |
| `npm run release:check` | Verify release metadata, assets, and known secret patterns. |

Styles are colocated with their UI owners under `src/apps/obsidian/ui/`; the production stylesheet
is generated from `src/apps/obsidian/styles.json`.

## Research architecture

Attest separates the stable `instant` and `thinking` strategies:

- **Instant** assembles evidence and synthesizes a deterministic answer without an agent loop.
  It offers no tools: tool-call markup the model writes as text for a known tool is removed from
  the saved answer and replaced by one localized notice suggesting Thinking; nothing is executed.
- **Thinking** uses capability-gated, multi-round tool calling. It falls back to Instant when the
  selected model cannot satisfy the tool/reasoning policy. A call to a tool the run does not offer
  or permit fails with `tool-unavailable`; the model receives the offered tool names and the
  timeline row shows a localized reason.
  The main agent may call `ask_clarification` with 1–3 questions (bounded like the Deep Research
  brief); a valid call ends the turn without an answer and stores the questions on the assistant
  message, which renders as a question card. Its answers are sent as the next ordinary user message
  in Thinking mode. The tool is not offered in the turn right after a clarification, nor to
  sub-agent sessions; malformed arguments fail with `invalid-clarification`.
- **Deep Research** is offered in the composer's mode selector. Its lifecycle is
  `plan → user review → gather → verify → synthesize → export`. The composer disables the item
  with the same readable reason as Thinking when the model has no verified tool calling.
  The `searches` limit bounds searching; the evidence limit (`evidenceItemsTotal`) counts only
  documents a branch read — pages opened with `fetch_web_page` and notes read with `read_note`
  or `get_active_note` — while `search_web` and `search_index` results are not charged.
  The user can skip either wait with one button: **Skip questions** plans with the recorded
  assumptions, and **Skip observations** marks every open supplied-observation test unavailable,
  stores `observationsSkipped` in the discovery state (absent in older states means not skipped)
  so no later cycle asks again, and continues to verification and the report, which labels the
  affected hypotheses as untested because the observation was skipped.
  The research is written in the language of its question, except direct quotations and source
  titles: every Deep Research prompt carries one shared language rule, and branch tasks name the
  research language. That language is reported by the clarification call as a BCP 47 tag, falls
  back to a script and stop-word guess over the question, and is stored as `language` in the
  research state (older states derive it from the question). The report headings, labels, stop
  and failure reasons and turn answers use the locale catalogue of that language; a language
  outside the seven UI locales gets English labels, while buttons, cards and notices follow the
  Obsidian UI language. The ar, de, es, fr and zh-CN answer labels need native review.
  New-chat defaults still offer only Instant and Thinking. The quality gates of the
  specification remain open and are tracked separately from availability:
  - Deep Research beats the recorded Thinking baseline on objective coverage and citation support
    on the frozen corpus for one local and one remote profile (no baseline is recorded yet);
  - unsupported-certainty and uncounted-conflict rates are not worse than that baseline;
  - the preset limits are confirmed or changed in one reviewed commit with the measurements;
  - every Deep Research UI surface has recorded live Obsidian observations;
  - old chats, `instant`, `thinking` and `map_sources` pass their existing suites unchanged.
- **Research export** writes a finished report as a new Markdown note on the report card's
  explicit Export action, independent of any running turn. The folder comes from the
  `researchExportFolder` setting (default `Attest/Research`) or a per-export override; both are
  untrusted and rejected with `research-export-folder` when empty, absolute or using backslashes,
  or when a segment is empty, padded with whitespace, or starts or ends with a dot (so `..`,
  `.attest/`, `.obsidian/` and every hidden folder are refused); only the whole value is trimmed. The note is named
  `<sanitized question> - YYYY-MM-DD.md` by the local date; a taken name, also one taken between
  the check and the create, moves to ` (2)`, ` (3)` and so on up to 20 attempts
  (`research-export-name`), and no existing note is ever replaced. Front matter holds quoted
  `type`, `chat_id`, `research_id`, `created` (UTC) and `quality`. Citation tokens resolved by the
  conversation registry become wikilinks for vault sources and Markdown links for http(s) web
  sources; other tokens stay as written. A failed export changes nothing and the card offers a
  retry.
  The report body is untrusted model output. Citations are linked first; then any fence line
  labelled `dataview`, `dataviewjs`, `tp`, `templater` or `query` is relabelled `text`, also inside
  blockquotes, callouts and lists. Outside code, embeds `![[x]]` become wikilinks and images become
  ordinary links; every `](target)` whose target is not http(s) is broken to `]\(target)`, whatever
  its label holds; a link reference definition with a non-http(s) target gets an escaped opening
  bracket; and `<` before a letter, `/` or `!` is escaped as `&lt;` except in `<http(s)://…>`
  autolinks.

Application dependencies flow inward: `apps → adapters → application → core`. Ports are declared in
`src/application`; Obsidian, filesystem, HTTP, and provider implementations remain in adapters or
apps.

## Provider protocols and storage

Every provider uses the `openai-compatible` format; Ollama is reached through its `/v1` endpoint and
Anthropic through its OpenAI-compatible endpoint, which does not return thinking or support prompt
caching. Profiles saved with the former `ollama` or `anthropic` formats are migrated to these `/v1`
endpoints on load, keeping their key. Reasoning may use inline chat-completions or the OpenAI
responses protocol, subject to the model capability probe.

The vault-local, file-backed index stores embeddings, chunk metadata, keyword postings, source
snapshots, and vectors. Rebuild an index after an incompatible index-format update.

## Research tools and diagnostics

Thinking can use vault retrieval, web search, registered-page fetching, index inventory, note tools,
document download, map-sources, and sub-agent tools. Tool exposure is capability and permission
gated; note mutation and document-download actions require explicit user permission.

Diagnostic reports contain capability, retrieval, web-selection, tool-loop, fallback, and streaming
metadata. Secrets are redacted before logging or diagnostic export. The release security audit is
recorded in [release-security-audit-0.1.0.md](release-security-audit-0.1.0.md).

## Release process

Before tagging a release, run:

```bash
npm run build
npm run release:check
```

The release check validates matching versions in `manifest.json`, `package.json`, and `versions.json`;
required repository files; the three Obsidian artifacts; forbidden files; and known credential
patterns. Release assets are `main.js`, `manifest.json`, and `styles.css` under the matching Git tag.

For contribution, branch, commit, review, and submission requirements, see [AGENTS.md](../AGENTS.md).
