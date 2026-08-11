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
- **Thinking** uses capability-gated, multi-round tool calling. It falls back to Instant when the
  selected model cannot satisfy the tool/reasoning policy.
- **Deep Research** is intentionally not part of the current release flow. Its future lifecycle is
  `plan → user review → gather → verify → synthesize → export`.

Application dependencies flow inward: `apps → adapters → application → core`. Ports are declared in
`src/application`; Obsidian, filesystem, HTTP, and provider implementations remain in adapters or
apps.

## Provider protocols and storage

Supported chat formats are `openai-compatible`, `anthropic`, and `ollama`. Reasoning may use inline
chat-completions or the OpenAI responses protocol, subject to the model capability probe.

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
