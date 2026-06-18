# Spec: Lazy-Loaded Skills

## Objective

Add vault-owned skills to Ixplorer without loading every skill body into every model request. Ixplorer discovers a compact catalog from `.ixplorer/skills/<skill-id>/SKILL.md`, selects at most one skill for each user message, and loads the selected file in full only when needed.

The feature must work for both tool-capable and non-tool-capable models:

- Tool-capable models receive the compact catalog and load the selected skill through `read_note`.
- Models without tools use a short selection request followed by a main request containing the selected skill inline.
- An explicit `@skill_id` mention overrides automatic selection for either model type.

Skills guide context use, answer structure, and diagnostics. They do not replace deterministic application guarantees such as evidence ordering, citation preservation, context budgeting, or retrieval diagnostics.

## Assumptions

1. The trusted skill root is fixed at `.ixplorer/skills` for v1 and is not configurable.
2. A request can use zero or one primary skill.
3. The folder name is the stable skill ID. Frontmatter `name` is the display name.
4. Default skill files are user-owned after installation and are never overwritten automatically.
5. Skill-driven vault mutations are out of scope for v1. Skills may produce previews, recommended paths, or proposed patches only.
6. Existing `ContextAssembler`, `NoteToolService`, model capability metadata, and context diagnostics remain the integration points.

## Tech Stack

- TypeScript Obsidian plugin.
- Existing Obsidian vault events for discovery cache invalidation.
- Existing `ChatModelProvider` and `NoteToolService` abstractions.
- Existing Markdown extraction pipeline for reading `SKILL.md`.
- Vitest for unit and integration coverage.
- No new runtime dependency is required. Frontmatter parsing should use Obsidian metadata APIs or a small repository-local parser sufficient for the defined schema.

## Commands

- Build: `npm run build`
- Test: `npm test -- --run`
- Lint/type-check: `npm run lint`
- Format check: `npm run format`
- Targeted tests: `npm test -- tests/unit/skill-discovery.test.ts tests/unit/skill-selection.test.ts tests/unit/skill-prompt.test.ts tests/unit/context-assembler.test.ts tests/unit/note-tools.test.ts --run`

## Project Structure

Expected implementation boundaries:

- `src/skills/` — skill schema, discovery, installation, catalog cache, selection, and loading orchestration.
- `src/research/` — prompt assembly, `read_note` integration, context budgeting, retrieval diagnostics, and selected-skill propagation.
- `src/ui/` — `@skill_id` parsing feedback and expanded diagnostics rendering.
- `src/indexing/` and `src/shared/pathFilters.ts` — exclusion of `.ixplorer/skills/**` from knowledge indexing and retrieval.
- `tests/unit/` — discovery, installation, selection, loading, prompt, budget, diagnostics, and default-skill behavior.
- `defaults/skills/` or an equivalent build-time source — bundled default `SKILL.md` files copied into the vault on first installation.

Vault layout:

```text
.ixplorer/
  skills/
    vault-context-assembly/
      SKILL.md
    citation-grounded-answer/
      SKILL.md
    ...
```

## Skill File Contract

Discovery is exactly one directory deep:

```text
.ixplorer/skills/<skill-id>/SKILL.md
```

Nested skills and Markdown files with other names are ignored.

Required frontmatter:

```yaml
---
name: Vault Context Assembly
description: Assemble prioritized evidence from explicit notes, the active note, graph context, and retrieval.
aliases:
  - vault-context
version: 1
---
```

Schema rules:

- `name`: required non-empty string used for display and catalog selection.
- `description`: required non-empty string included in the prompt catalog.
- `aliases`: optional list of unique strings accepted by explicit mentions and selection matching.
- `version`: optional string or positive number used for diagnostics and future upgrade tooling.
- `<skill-id>`: stable identity and canonical `@skill_id` mention.
- Workflow, triggers, formatting rules, and examples belong in the Markdown body.

Invalid files are omitted from the catalog and reported through diagnostics. Missing required fields, malformed frontmatter, duplicate names, duplicate aliases, or ambiguous identifiers are invalid. Name and alias comparisons are case-insensitive. If multiple files collide, every colliding entry is omitted rather than choosing one based on traversal order.

The product does not impose a configurable skill-count limit. Technical metadata validation still protects prompt size and parser stability. Oversized frontmatter or descriptions are rejected with diagnostics; they are never silently truncated.

## Default Skills

The first release installs these ten skills:

1. `vault-context-assembly`
2. `note-synthesis`
3. `literature-review`, with `research-review` as an alias
4. `project-memory`
5. `meeting-notes`
6. `zettelkasten-linker`
7. `citation-grounded-answer`
8. `contradiction-finder`
9. `prompt-template-builder`
10. `rag-debugger`

Default installation rules:

- On first initialization, create `.ixplorer/skills` and all missing first-release defaults.
- Record which default IDs have been introduced by the plugin.
- Never overwrite an existing `SKILL.md`, including a user-modified default.
- If a known default is deleted, do not recreate it on restart. Deletion is the v1 disable mechanism.
- A future plugin version may introduce a previously unknown default ID. It may create that new file without modifying existing IDs.
- Installation failures are non-fatal and appear in diagnostics or a user-visible notice.

## Discovery and Catalog Lifecycle

The discovery service maintains an in-memory catalog containing only:

- stable skill ID;
- frontmatter `name`;
- `description`;
- vault-relative `path`;
- aliases and version for local matching and diagnostics, but not as required prompt fields.

The prompt-visible catalog contains only `name`, `description`, and `path`. It does not contain skill bodies, examples, or complete trigger sections.

Catalog behavior:

- Perform initial discovery after default installation.
- Subscribe to Obsidian create, modify, delete, and rename events under `.ixplorer/skills`.
- Reparse the affected `SKILL.md` or invalidate the relevant entry.
- Use the current cached catalog for every request.
- Sort entries deterministically by stable skill ID.
- Expose discovered valid count and validation warnings through diagnostics.
- Account for catalog tokens in request context estimation.
- If a valid catalog cannot fit within the request budget, fail explicitly instead of silently omitting arbitrary skills.

## Selection

### Explicit selection

The user can select a skill with an exact mention:

```text
@citation-grounded-answer ответь только по заметкам проекта
```

Selection rules:

- Match the canonical folder ID or an exact alias, case-insensitively.
- Remove the recognized control mention from the research question before retrieval and answer generation.
- Preserve the original message for the visible transcript.
- An explicit mention overrides automatic selection.
- More than one distinct valid skill mention is a request validation error in v1.
- An unknown or ambiguous skill mention produces a clear notice and does not silently fall back to a similarly named skill.

### Automatic selection for tool-capable models

The main request includes the compact catalog and an instruction to select a skill only when its description clearly applies. The model may choose no skill. When it chooses a skill, it must call `read_note` with the exact catalog path before answering.

The tool loop must enforce the loading contract: an answer cannot be accepted as skill-guided if the selected skill was not read successfully. The loaded path must remain inside `.ixplorer/skills/<skill-id>/SKILL.md`.

### Automatic selection for models without tools

Non-tool models use two stages:

1. Send a short selector request containing the normalized question and compact catalog. Require structured output identifying one exact skill ID or `none`.
2. Validate the selector output locally, read the chosen `SKILL.md` in full, and include it inline in the main request.

The selector receives no vault evidence or private note content beyond the user's question. Invalid selector output falls back to `none` with a diagnostic warning. The selection pass must not generate a user-visible answer.

An explicit `@skill_id` skips the selection request and loads that skill directly.

## Full Skill Loading

The selected `SKILL.md` is atomic context:

- Load the complete file, including frontmatter and body.
- Do not apply the normal `read_note` 16,000-character truncation.
- Validate that the resolved vault path is a discovered skill path under the trusted root.
- If the full file cannot fit, return `skill-too-large`; never silently truncate it.
- Reserve context for the system prompt, compact catalog, selected skill, and model output before allocating evidence.
- Reduce evidence according to the existing evidence planner when necessary.

For tool-capable models, loading uses the `read_note` tool path and appears in tool diagnostics. For non-tool models, the application uses the same validation and extraction semantics before inserting the file inline.

Skill instructions are delimited from evidence and user content. Ordinary vault notes cannot become instructions merely by resembling a skill file.

## Prompt Assembly

Without a selected skill, the request contains:

- Ixplorer system instructions;
- compact skill catalog;
- question and chat history;
- planned evidence.

It does not contain any `SKILL.md` body.

With a selected skill, the complete body is added as trusted skill instructions. Precedence is:

1. Application safety and deterministic invariants.
2. Selected skill instructions.
3. User request.
4. Vault and web evidence, which are data rather than instructions.

A skill cannot disable citation validation, escape the trusted vault root, enable mutations, or override context-window limits.

## Deterministic Context Assembly

`vault-context-assembly` describes how the model should use and explain context, but evidence collection order remains implemented in `ContextAssembler`:

1. Explicitly named or attached files.
2. Active note when enabled.
3. Links, backlinks, and embeds through graph context.
4. RAG retrieval.

The skill must not claim a source was searched or loaded unless application diagnostics confirm it.

All files under `.ixplorer/skills/**` are excluded from:

- vector and keyword indexing;
- RAG results;
- graph expansion and backlinks;
- evidence citations;
- general note search results unless a dedicated skill-loading operation requests the exact path.

## Default Skill Behavior

### `vault-context-assembly`

- Use the deterministic explicit → active → graph → RAG evidence order.
- Explain which source groups were used and what was unavailable.
- Never represent prompt-only behavior as an application-level retrieval guarantee.

### `note-synthesis`

- Group material by theme.
- Add no unsupported facts.
- Identify contradictions.
- End with missing context.

### `literature-review`

- Extract theses and compare authors or approaches.
- Separate claims, evidence, and assumptions.
- Produce an argument map and cited review.
- Accept `research-review` as an alias.

### `project-memory`

- Prefer ADR, decision, log, and status notes.
- Distinguish decisions from proposals.
- Include date, source, and confidence.
- Propose a project-summary patch without writing it.

### `meeting-notes`

- Extract decisions, action items, risks, and blockers.
- Connect people, dates, and projects when supported.
- Generate a follow-up note preview only.

### `zettelkasten-linker`

- Propose links, backlinks, duplicate topics, and atomic note splits.
- Never modify notes in v1.

### `citation-grounded-answer`

- Cite every material verifiable claim.
- In vault-only mode, use no general knowledge.
- State when evidence was not found rather than guessing.
- End with `Used sources`, `Missing evidence`, and `Ambiguities` sections.

### `contradiction-finder`

- Compare semantically similar claims.
- Use modified dates and frontmatter dates when available.
- Group conflicting statements and propose which note should be reviewed.
- Do not update notes.

### `prompt-template-builder`

- Produce reusable Markdown with `{selection}`, `{active_note}`, and `{context}` variables when applicable.
- Describe expected output.
- Return a recommended path but do not save the file.

### `rag-debugger`

- Explain actual structured diagnostics supplied by the application.
- Include query variants, ranked chunks, filtering, budget, tools, index status, and actionable recommendations.
- Never infer missing scores or retrieval events from evidence text.

## RAG Diagnostics

The application must expose sufficient structured data for `rag-debugger` and the diagnostics UI:

- query variants;
- retrieved chunks with path, chunk ID, rank, and score;
- dropped and filtered candidates with reason;
- context token limit, reservations, allocations, and actual use;
- tool calls and outcomes;
- index availability/status relevant to the request;
- actionable conditions such as stale/missing index, explicit attachment opportunity, graph expansion opportunity, and budget pressure.

The existing diagnostics panel is expanded to render these values. `rag-debugger` receives a bounded structured diagnostic snapshot and converts it into a readable explanation; it does not reconstruct diagnostics from the normal evidence prompt.

## Skill Diagnostics

Extend context diagnostics with:

- discovered valid skill count;
- catalog validation warnings;
- selected skill ID, display name, and path;
- selection mode: `automatic | manual | none`;
- load mode: `read_note | inline | none`;
- loaded character and estimated token counts;
- load status and error reason;
- explicit indication that truncation did not occur;
- selector diagnostics for non-tool models without exposing private prompt content.

The selected skill metadata is persisted with the answer/chat record so regenerated answers and historical diagnostics remain explainable. Selection remains scoped to one user message and does not automatically carry into the next message.

## Code Style

Use explicit domain types and pure validation/selection helpers. Keep vault I/O behind services.

```ts
interface SelectedSkill {
  id: string;
  name: string;
  path: string;
  selectionMode: "automatic" | "manual";
  loadMode: "read_note" | "inline";
}

const selection = selectExplicitSkill(question, catalog);
```

Avoid boolean combinations such as `manualSkill` plus `usedTool`; use discriminated unions for selection and load outcomes. Return explicit error codes including `invalid-skill`, `ambiguous-skill`, `skill-too-large`, and `skill-read-failed`.

## Testing Strategy

Use Vitest with fake vault/file providers and fake chat models.

### Unit tests

- Discover only `.ixplorer/skills/<skill-id>/SKILL.md`.
- Parse valid metadata and reject missing, malformed, duplicate, ambiguous, and oversized metadata.
- Refresh catalog entries on create, modify, delete, and rename events.
- Install defaults once, preserve edits, and do not restore deleted known defaults.
- Add a newly introduced default without changing existing files.
- Build a catalog containing only name, description, and path.
- Confirm no skill body enters the default prompt.
- Parse exact `@skill_id` and alias mentions without fuzzy matching.
- Reject multiple explicit skills.
- Validate structured automatic selector output.
- Skip the selector request for explicit mentions.
- Load a selected file completely above 16,000 characters when budget allows.
- Return `skill-too-large` instead of truncating.
- Reserve skill tokens before evidence allocation.
- Reject loading outside the trusted root.
- Exclude `.ixplorer/skills/**` from indexing, retrieval, graph context, and evidence.
- Persist and render skill diagnostics.

### Integration tests

- A tool-capable model receives the catalog, calls `read_note`, and follows `vault-context-assembly` output rules.
- A non-tool model selects a skill in the selector pass and receives the complete file inline in the main pass.
- `@citation-grounded-answer` enforces citations and the three required closing sections.
- `rag-debugger` reports real ranked chunks, scores, filtered reasons, budget, tools, and index state.
- No selected skill leaves all skill bodies absent from the main request.
- Catalog changes are visible in the next request without restarting the plugin.

No broad coverage percentage is mandated, but every success criterion and failure mode above requires a deterministic test.

## Boundaries

### Always

- Treat only discovered paths under `.ixplorer/skills` as trusted skills.
- Preserve complete selected skill content or fail explicitly.
- Include catalog and selected-skill tokens in context estimation.
- Keep selection scoped to one message.
- Preserve user-edited skill files.
- Emit diagnostics for selection, loading, and validation failures.
- Keep deterministic context and citation guarantees in code.

### Ask first

- Make the skill root configurable.
- Enable multiple simultaneous skills.
- Add automatic writing or patch application to vault notes.
- Change default skills after v1 in a way that modifies existing user files.
- Add a separate configured model for selection.

### Never

- Load every skill body by default.
- Silently truncate a selected skill.
- Treat ordinary notes or retrieved evidence as trusted instructions.
- Restore a user-deleted known default on restart.
- Overwrite user-modified defaults.
- Let skills bypass path restrictions, context limits, or mutation confirmation.
- Index `.ixplorer/skills/**` as knowledge evidence.

## Success Criteria

1. First initialization creates all ten default skills under `.ixplorer/skills` without overwriting existing files.
2. Discovery includes only valid one-level `SKILL.md` files and refreshes after vault changes.
3. A normal request contains the compact catalog but no skill body.
4. At most one skill is selected per message, automatically or through exact `@skill_id`/alias mention.
5. Tool-capable models load the chosen skill through `read_note` before producing a skill-guided answer.
6. Non-tool models use a selector pass and receive the complete chosen skill inline.
7. Selected skills are never silently truncated; oversized skills fail with `skill-too-large`.
8. Skill and output tokens are reserved before evidence is reduced.
9. `.ixplorer/skills/**` never appears in RAG, graph evidence, or citations.
10. `vault-context-assembly` reflects the application-enforced explicit → active → graph → RAG order.
11. `citation-grounded-answer` cites material claims and renders `Used sources`, `Missing evidence`, and `Ambiguities`.
12. `rag-debugger` uses real structured retrieval diagnostics and the UI exposes the required diagnostic fields.
13. Skill diagnostics identify discovery count, selection, path, selection/load mode, size, and failures.
14. Meeting, project-memory, Zettelkasten, contradiction, and prompt-template skills produce previews or proposals only and never mutate the vault.
15. Build, type-check, and all targeted and regression tests pass.

## Risks and Mitigations

- **Extra latency for non-tool models:** keep selector prompts compact, deterministic, and free of evidence; skip the call for explicit mentions.
- **Catalog prompt growth:** validate metadata sizes, count catalog tokens, and fail explicitly when the request cannot fit.
- **Prompt injection from notes:** trust only exact discovered paths and delimit skills from evidence.
- **Model fails to call `read_note`:** enforce tool-loop completion before accepting a skill-guided answer.
- **Loss of user edits during upgrades:** record introduced defaults and never overwrite existing paths.
- **Skills claim capabilities not implemented by code:** default skill text must distinguish instructions, previews, and deterministic application behavior.
- **Diagnostics expose too much content:** provide metadata, IDs, paths, scores, counts, and bounded previews rather than full private chunks.

## Open Questions

None. Product decisions were approved on 2026-06-18. Implementation constants for metadata safety bounds may be selected during planning, but must be explicit, tested, and must never cause silent truncation.
