# Implementation Plan: Lazy-Loaded Skills

## Architecture

- Add a vault-backed `SkillRegistry` responsible for default installation, one-level discovery, metadata validation, event-driven cache refresh, explicit mention parsing, and full trusted-path loading.
- Add a `SkillSelectionService` responsible for compact catalog rendering and the second-pass selector used by non-tool models.
- Resolve the skill before context assembly so the selected skill token cost is reserved before evidence planning.
- Keep tool-capable automatic selection in the answer tool loop; expose a restricted full-file skill loader through `read_note`.
- Extend existing diagnostics instead of creating a second diagnostics channel.

## Tasks

### 1. Skill domain and discovery

- Add domain types, frontmatter validation, catalog formatting, mention parsing, and trusted path checks.
- Add unit tests covering valid, invalid, duplicate, ambiguous, and oversized metadata.
- Verify: `npm test -- tests/unit/skill-registry.test.ts --run`.

### 2. Default installation and lifecycle

- Bundle ten default skill documents.
- Install only defaults not previously introduced; preserve edits and deletions.
- Subscribe to vault create/modify/delete/rename events and refresh the cache.
- Verify with registry lifecycle tests and type-check.

### 3. Selection and loading

- Implement explicit `@skill_id` selection and two-pass automatic selection for non-tool models.
- Add full-file atomic loading with `skill-too-large` and trusted-root enforcement.
- Add tool-capable catalog instructions and enforce skill loading through `read_note`.
- Verify with selector, prompt, and note-tool tests.

### Checkpoint: Core loading

- Targeted skill tests pass.
- No unselected skill body appears in prompts.
- Build succeeds.

### 4. Context, indexing, and diagnostics

- Reserve selected-skill tokens before context assembly/evidence planning.
- Exclude `.ixplorer/skills/**` from indexing, graph, retrieval, picker, and evidence.
- Extend retrieval and skill diagnostics with ranks, scores, reasons, index status, and budget data available in the current architecture.
- Verify with context, indexing, retrieval, and diagnostics tests.

### 5. Application and UI integration

- Initialize the registry during plugin startup and pass it into research services.
- Preserve the original visible question while using the normalized question for retrieval.
- Render selected-skill and retrieval diagnostic details in the existing diagnostics panel.
- Verify with controller and rendering tests.

### 6. End-to-end behavior and review

- Add integration tests for tool, non-tool, explicit mention, citation-grounded output contract, and RAG diagnostics.
- Run full tests, formatting, lint/type-check, and production build.
- Review correctness, readability, architecture, security, and performance against the specification.

## Risks

- Obsidian hidden-folder APIs differ from normal vault file APIs: keep registry I/O behind an adapter and test with fakes.
- Tool models may answer without loading a selected skill: validate tool diagnostics and do not report a skill as loaded unless `read_note` succeeded.
- Selector latency for non-tool models: skip it for explicit mentions and use a compact zero-temperature request.
- Catalog growth: reject oversized metadata and include catalog tokens in context checks.

## Open Questions

None.
