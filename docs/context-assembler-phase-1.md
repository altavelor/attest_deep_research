# Context Assembler Phase 1

## Objective

Add a first-pass context assembly layer for Ixplorer chat so explicitly selected or mentioned
vault files can be used as authoritative evidence before normal RAG retrieval.

## Scope

- Attached context defaults to `include`.
- The chat composer exposes `Include` and `Filter` modes.
- Explicit markdown files up to 10,000 characters are included as full evidence.
- Oversized markdown files use deterministic heading-aware chunk selection.
- Non-markdown files supported by existing extractors are included through extracted chunks.
- Active file auto-context is controlled by a setting and defaults to enabled.
- Exact `@path/to/file.md` mentions are resolved as explicit context.
- Diagnostics are produced for user-facing summaries and optional raw debug output.
- Web evidence stays on the existing merge path for phase 1.

## Out of Scope

- Graph traversal through links, embeds, and backlinks.
- LLM-generated summaries or compression.
- Tool calling and lazy-loaded skills.
- Combined/external indexes.
- PDF text cache.
- Manual adjacent chunk expansion UI.

## Success Criteria

- Explicit files can be included without relying on embedding rank.
- Filter mode preserves the previous behavior of constraining retrieval to selected paths.
- Context assembly reports included and dropped evidence.
- Existing chat, retrieval, and indexing tests continue to pass.
