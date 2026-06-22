# Implementation Plan: Universal reasoning response streaming

## Status

Implemented on 2026-06-21. Automated unit, contract, migration, redaction, formatting-component, type, and production-build verification passes. Live cross-provider endpoint checks and visual acceptance inside Obsidian remain manual release checks because they require configured external models and an interactive Obsidian runtime.

## Overview

Replace the current content-only streaming path and monolithic Responses capability gate with a provider-neutral event contract, format-tolerant adapters, one stable reasoning disclosure, and independent capability discovery. Work is ordered so parsing correctness is proven before orchestration, UI, persistence, and settings behavior change.

## Architecture decisions

1. Normalize inbound stream shapes before orchestration.
2. Parse by event/field shape, not provider or model name.
3. Keep Chat Completions and Responses adapters independent but make them emit the same event union.
4. Separate visible reasoning from opaque continuation state.
5. Treat capability data as hints with provenance, never as parser gates.
6. Use passive observation and metadata for automatic refresh; keep generation probes explicit.
7. Render one disclosure per assistant response without changing the existing chat design system.
8. Land changes in small compatibility-preserving slices with checkpoints.
9. Treat text from non-terminal/tool-call rounds as provisional checkpoints and collapse them with reasoning after finalization.
10. Run one serialized, identifiable `AgentRun` per chat and project its generic events into research UI state.
11. Snapshot skills/tool policy per run and preserve tool-call/result integrity during pruning or compaction.
12. Coalesce UI updates independently from transport parsing and persisted event order.

## Dependency graph

```text
Normalized event contract
  ├── Chat Completions structured reasoning parser
  ├── Inline-tag state machine
  └── Responses reasoning parser
         │
         v
Orchestration propagation + continuation separation
         │
         ├── Assistant reasoning state + persistence
         │       └── Incremental transcript UI
         │
         └── Passive capability observations
                 ├── Capability cache/resolvers
                 └── Settings refresh + optional probes
```

## Phase 1: Contract and format parsers

### Task 0: Reconcile the existing tool-loop specification

**Description:** Amend the older reasoning tool-loop specification and plan so they reference the accepted streaming specification for stream, UI, persistence, protocol, and capability behavior.

**Acceptance criteria:**

- [ ] No active specification calls Responses the universally authoritative reasoning protocol.
- [ ] No active specification describes visible reasoning as ephemeral when persistence is approved here.
- [ ] Tool-loop source policy, evidence, citation, and fallback requirements remain unchanged.

**Verification:**

- [ ] Documentation search finds no unresolved contradictory requirement.
- [ ] Human review approves the reconciled wording before code changes.

**Dependencies:** Accepted streaming specification.

**Files likely touched:** `docs/reasoning-tool-loop-spec.md`, `docs/reasoning-tool-loop-plan.md`.

**Estimated scope:** Small.

### Task 1: Introduce the normalized stream event contract

**Description:** Add the provider-neutral discriminated union and related reasoning segment types. Adapt internal compile-time consumers without changing runtime output.

**Acceptance criteria:**

- [ ] Contract represents reasoning start/delta/end, final text, tool deltas, usage, and completion.
- [ ] Provider field names do not appear in the core event types.
- [ ] Existing non-reasoning callers compile without runtime behavior changes.

**Verification:**

- [ ] `npm test -- tests/unit/model-round-contracts.test.ts --run`
- [ ] `npx tsc --noEmit`

**Dependencies:** Task 0.

**Files likely touched:** `src/shared/types.ts`, `tests/unit/model-round-contracts.test.ts`, one compatibility adapter if required.

**Estimated scope:** Small.

### Task 2: Parse structured Chat Completions reasoning fields

**Description:** Extend the OpenAI-compatible Chat Completions parser to emit normalized events for `reasoning_details`, `reasoning`, `reasoning_content`, and `thinking`, with deterministic precedence and alias deduplication.

**Acceptance criteria:**

- [ ] Each supported field streams visible reasoning separately from final content.
- [ ] Encrypted/unknown reasoning details are not rendered.
- [ ] Multiple aliases in one chunk do not duplicate visible text.
- [ ] Ordinary content/tool streams remain unchanged.

**Verification:**

- [ ] Targeted parser tests use one fixture per response shape.
- [ ] Tests cover malformed optional fields and differing duplicate aliases.

**Dependencies:** Task 1.

**Files likely touched:** `src/client/chat/ChatModelClient.ts`, `src/client/chat/ChatCompletionsRoundAdapter.ts`, `tests/unit/chat-model-client.test.ts`, `tests/unit/model-round-contracts.test.ts`.

**Estimated scope:** Medium.

### Task 3: Add incremental inline reasoning-tag parsing

**Description:** Implement an answer-scoped state machine that separates configured inline reasoning tags from final content even when tags are split across arbitrary chunks.

**Acceptance criteria:**

- [ ] Default tag pairs from the spec are recognized.
- [ ] Every split point across opening and closing tags is tested.
- [ ] Incomplete/malformed tags fail safely without losing final content.
- [ ] Tag markers never reach rendered reasoning or final answer.

**Verification:**

- [ ] New focused state-machine test file passes.
- [ ] Fuzz/property-style split-boundary cases pass deterministically.

**Dependencies:** Task 1.

**Files likely touched:** new `src/client/chat/InlineReasoningParser.ts`, new unit test file, `src/client/chat/ChatModelClient.ts`.

**Estimated scope:** Medium.

### Checkpoint: Chat Completions formats

- [ ] Structured fields and inline tags produce identical normalized event semantics.
- [ ] No provider-name conditional exists in parser code.
- [ ] Existing chat/tool parser tests pass.
- [ ] Human review confirms precedence and tag behavior.

### Task 4: Correct and broaden Responses reasoning parsing

**Description:** Support standard reasoning text/summary events, compatible extension events, terminal-only reasoning content, and terminal lifecycle variants.

**Acceptance criteria:**

- [ ] `response.reasoning_text.delta`, `response.reasoning_summary_text.delta`, and `response.reasoning.delta` map correctly.
- [ ] Terminal `reasoning.content[]` and `reasoning.summary[]` are recovered when no streamed copy exists.
- [ ] Streamed and terminal text/reasoning are validated without false mismatches.
- [ ] Completion works with and without a trailing `[DONE]`.

**Verification:**

- [ ] `npm test -- tests/unit/openai-responses-client.test.ts --run`
- [ ] Fixtures cover standard, extension, terminal-only, incomplete, failed, and truncated streams.

**Dependencies:** Task 1.

**Files likely touched:** `src/client/chat/OpenAiResponsesClient.ts`, `src/client/chat/OpenAiResponsesStreamParser.ts`, `tests/unit/openai-responses-client.test.ts`.

**Estimated scope:** Medium.

## Phase 2: End-to-end propagation and continuation

### Task 5: Introduce AgentRun and propagate non-tool synthesis

**Description:** Introduce the serialized provider-neutral run coordinator, then replace text/reasoning-specific callback branches in the direct synthesis path with exhaustive normalized event handling.

**Acceptance criteria:**

- [ ] Text and reasoning ordering is preserved from adapter to `ResearchStreamEvent`.
- [ ] Terminal fallback does not duplicate already streamed output.
- [ ] Non-reasoning behavior remains unchanged.
- [ ] A non-terminal round buffers text until it can be classified as intermediate or final.
- [ ] Every event carries a `runId`; reducers ignore events from cancelled or replaced runs.
- [ ] Only one mutating run is active per chat and replacement settles the previous run.
- [ ] Skills and tool policy are immutable snapshots for the run lifetime.

**Verification:**

- [ ] Targeted research pipeline and synthesis tests pass.
- [ ] Tests assert exact ordered event sequences.

**Dependencies:** Tasks 2, 3, and 4.

**Files likely touched:** `src/research/AnswerSynthesisService.ts`, `src/research/types.ts`, `tests/unit/research-pipelines.test.ts`, `tests/unit/research-service.test.ts`.

**Estimated scope:** Medium.

### Task 6: Propagate normalized events through tool loops

**Description:** Update agentic and note-tool loops to preserve reasoning segments across rounds while keeping visible reasoning and opaque continuation state separate.

**Acceptance criteria:**

- [ ] Reasoning segments retain stable round-scoped IDs.
- [ ] Tool-call deltas and reasoning remain correctly ordered.
- [ ] Required provider continuation blocks are passed back unmodified.
- [ ] Continuation state is disposed on completion, error, cancellation, and fallback.
- [ ] Text accompanying a tool-call round becomes an ordered intermediate checkpoint instead of temporary final-answer content.
- [ ] Existing `answer-reset` behavior no longer deletes provisional text; superseded checkpoints remain in research progress.
- [ ] Tool outputs are bounded before model-context insertion and diagnostics.
- [ ] Budgets and cancellation are checked after each tool result and before another model round.
- [ ] Context pruning or compaction never separates a tool call from its result or rewrites opaque identifiers.

**Verification:**

- [ ] Targeted tool-loop and agentic-runner tests pass.
- [ ] Tests cover multiple tool rounds, cancellation, retry, and fallback cleanup.

**Dependencies:** Task 5.

**Files likely touched:** `src/research/tools/ToolLoopRunner.ts`, `src/research/AgenticResearchRunner.ts`, related two test files.

**Estimated scope:** Medium.

### Checkpoint: Transport-to-controller path

- [ ] Both protocols produce one ordered application event stream.
- [ ] Tool loops preserve but do not display opaque state.
- [ ] No existing final answer or tool-call regression.
- [ ] Full unit suite and type check pass.

## Phase 3: Assistant state, persistence, and UI

### Task 7: Replace `reasoningOpen` with explicit reasoning state

**Description:** Introduce phase, disclosure, timing, ordered reasoning segments, and intermediate checkpoint state. Add pure transition helpers for normalized and reasoning-loop events.

**Acceptance criteria:**

- [ ] Auto-open/close and user-open/closed transitions are deterministic.
- [ ] First reasoning delta can create an empty assistant answer message.
- [ ] Completion, cancellation, and failure finalize phase and duration.
- [ ] Existing messages without reasoning remain valid.
- [ ] Two or more reasoning/intermediate stages preserve their round order.
- [ ] Finalization collapses `auto` disclosure without discarding checkpoints.

**Verification:**

- [ ] Pure state-transition tests cover every phase/disclosure combination.
- [ ] `npx tsc --noEmit`

**Dependencies:** Task 5.

**Files likely touched:** `src/ui/rendering.ts`, `src/ui/ResearchQuestionController.ts`, `tests/unit/chat-rendering.test.ts`.

**Estimated scope:** Medium.

### Task 8: Render one reasoning disclosure in the existing style

**Description:** Update transcript rendering to create one native `Research progress` disclosure before the answer and render all reasoning and intermediate checkpoints inside it with active/completed labels.

**Acceptance criteria:**

- [ ] Exactly one disclosure is rendered per assistant message.
- [ ] Active and completed labels include the correct state/duration.
- [ ] Keyboard interaction updates explicit disclosure state.
- [ ] Existing message header, answer, citation, copy, and diagnostics styling remains unchanged.
- [ ] Intermediate answers are visibly provisional and cannot be mistaken for the final answer.

**Verification:**

- [ ] DOM-oriented tests validate structure and disclosure semantics rather than source-code substrings.
- [ ] Manual inspection in light and dark Obsidian themes.

**Dependencies:** Task 7.

**Files likely touched:** `src/ui/ChatTranscript.ts`, `styles.css`, `tests/unit/reasoning-ui-contract.test.ts`, UI test helpers.

**Estimated scope:** Medium.

### Task 9: Patch the active message instead of re-rendering the transcript per token

**Description:** Add an incremental update boundary for the active assistant message, throttle Markdown work, and preserve user scroll/disclosure state.

**Acceptance criteria:**

- [ ] A reasoning/text delta does not clear the full transcript.
- [ ] User collapse and scroll position survive later deltas.
- [ ] Markdown finalization produces the same final DOM as a loaded saved chat.
- [ ] Update frequency is bounded during high-token-rate streams.

**Verification:**

- [ ] UI tests assert stable node identity across multiple deltas.
- [ ] Manual long-response test shows no reasoning-block flicker or forced reopen.

**Dependencies:** Task 8.

**Files likely touched:** `src/ui/ChatTranscript.ts`, `src/ui/IxplorerChatView.ts`, `src/ui/ResearchQuestionController.ts`, UI tests.

**Estimated scope:** Medium.

### Task 10: Persist visible reasoning and migrate older chats

**Description:** Store reasoning segments, intermediate checkpoints, duration, and disclosure state separately from final answer content while preserving older saved chats.

**Acceptance criteria:**

- [ ] Saved/reloaded reasoning matches the completed UI.
- [ ] Older schema messages load without synthetic reasoning state.
- [ ] Normal copy, prompt history, compaction, title generation, and exports exclude reasoning by default.
- [ ] Opaque provider state is never serialized.
- [ ] Intermediate checkpoints survive reload but remain excluded from normal prompt/copy/export projections.

**Verification:**

- [ ] Targeted chat-store, rendering, and compaction tests pass.
- [ ] Saved JSON fixture contains no opaque state.

**Dependencies:** Task 7.

**Files likely touched:** `src/chat/ChatStore.ts`, `src/ui/rendering.ts`, `src/chat/ChatCompaction.ts`, related tests.

**Estimated scope:** Medium.

### Checkpoint: User-visible reasoning

- [ ] Target screenshot behavior is reproduced without a chat redesign.
- [ ] Reasoning remains separate from final content and copy/history paths.
- [ ] Long streaming responses do not reset disclosure state.
- [ ] Reloaded chats preserve the completed reasoning block.
- [ ] Human review approves UX before capability settings change.

## Phase 4: Capability discovery without profile re-save

### Task 11: Replace the aggregate reasoning gate with independent capability states

**Description:** Introduce protocol, visible-output, request-control, summary, tool, and continuation states with provenance and freshness.

**Acceptance criteria:**

- [ ] `unknown`, `supported`, and `unsupported` are represented independently.
- [ ] A failed Responses/tool/summary check cannot disable Chat Completions reasoning parsing.
- [ ] Existing settings migrate additively with a bumped capability contract version.

**Verification:**

- [ ] Settings migration and effective-resolution tests pass.
- [ ] Tests cover partial/contradictory capability snapshots.

**Dependencies:** Phase 2 checkpoint.

**Files likely touched:** `src/settings/settings.ts`, `src/shared/types.ts`, `tests/unit/settings.test.ts`.

**Estimated scope:** Medium.

### Task 12: Record passive capability observations

**Description:** Update a separate cache after successful real requests based on observed stream shapes and accepted outbound controls.

**Acceptance criteria:**

- [ ] Observed response formats are persisted without mutating an open profile modal.
- [ ] Cache identity includes normalized endpoint, model, protocol, and contract version but no raw credential.
- [ ] Stale requests cannot publish observations after endpoint/model changes.

**Verification:**

- [ ] Cache and concurrency tests cover success, cancellation, stale publication, and endpoint/model changes.

**Dependencies:** Tasks 5 and 11.

**Files likely touched:** new capability cache module, `src/main.ts`, `src/settings/settings.ts`, new unit tests.

**Estimated scope:** Medium.

### Task 13: Add optional metadata resolvers

**Description:** Define a common resolver interface and implement metadata mapping only where a compatible endpoint exposes useful model capabilities. Generic operation remains unchanged when no resolver matches.

**Acceptance criteria:**

- [ ] Resolver output uses the common capability snapshot with source/freshness.
- [ ] Resolver failure returns `unknown` and never suspends a profile.
- [ ] Core parsers, orchestration, and UI contain no provider-specific checks.
- [ ] No generation request is issued.

**Verification:**

- [ ] Resolver contract tests include a generic no-match endpoint and at least one metadata-rich fixture.

**Dependencies:** Task 11.

**Files likely touched:** new resolver module(s), `src/settings/connectionTests.ts`, resolver tests.

**Estimated scope:** Medium.

### Task 14: Refresh capabilities independently of profile save

**Description:** Add refresh scheduling for startup, settings open, endpoint/model changes, contract invalidation, and a manual action.

**Acceptance criteria:**

- [ ] `Refresh capabilities` is available without opening edit/save workflow.
- [ ] Opening settings refreshes stale metadata in the background.
- [ ] Changing the selected model cancels or ignores the previous refresh.
- [ ] Saving a profile is not required for state updates.

**Verification:**

- [ ] Settings UI tests exercise refresh without `onSave`.
- [ ] Manual test confirms status changes in place.

**Dependencies:** Tasks 12 and 13.

**Files likely touched:** `src/settings/SettingsTab.ts`, capability cache/resolver modules, settings UI tests.

**Estimated scope:** Medium.

### Task 15: Replace the monolithic generation probe with explicit probes

**Description:** Keep generation-based verification behind a user action and probe reasoning visibility, tools, continuation, and summaries independently.

**Acceptance criteria:**

- [ ] Automatic refresh never calls a generation endpoint.
- [ ] A reasoning visibility probe performs one bounded model request and does not require tools or summary.
- [ ] Tool continuation probe runs only when explicitly requested.
- [ ] Positive and negative results have separate TTLs and useful failure diagnostics.

**Verification:**

- [ ] Request-count tests prove bounded independent probes.
- [ ] Cancellation and stale publication tests pass.

**Dependencies:** Tasks 11 and 14.

**Files likely touched:** `src/settings/responsesCapabilityProbe.ts`, `src/settings/chatProfileProbes.ts`, probe tests, `src/settings/SettingsTab.ts`.

**Estimated scope:** Medium.

### Checkpoint: Capability UX

- [ ] Profile re-save is no longer needed.
- [ ] Automatic refresh has zero generation cost.
- [ ] Partial capability failures remain isolated.
- [ ] Parser behavior is independent of cache status.
- [ ] Settings surface shows source, freshness, and failure reason.

## Phase 5: Fallback, diagnostics, and release verification

### Task 16: Add conservative request fallback

**Description:** Retry once without an unsupported optional reasoning control or with a confirmed alternate protocol only before stream output begins.

**Acceptance criteria:**

- [ ] Retry occurs only for classified unsupported endpoint/parameter errors.
- [ ] No retry occurs after reasoning, text, or tool output.
- [ ] Abort, authentication, rate-limit, and generic server failures do not trigger unsafe protocol fallback.
- [ ] Successful fallback updates capability hints and diagnostics.

**Verification:**

- [ ] HTTP/client tests cover every retry and non-retry classification.

**Dependencies:** Tasks 11, 12, and 15.

**Files likely touched:** `src/client/common/http.ts`, client selection/orchestration module, `src/shared/errors.ts`, related tests.

**Estimated scope:** Medium.

### Task 17: Add agent-run diagnostic contracts and producers

**Description:** Implement the additive contracts from `docs/diagnostic-report-readable-spec.md` and collect bounded diagnostics across transport, parser, `AgentRun`, projection, capability, delivery, persistence, attempts, and fallback.

**Acceptance criteria:**

- [ ] Every new event is correlated by `runId`; attempts retain separate counters and statuses.
- [ ] Stream, projection, delivery, capability, budget, and lifecycle diagnostics use stable codes and bounded counts.
- [ ] Timeline is limited to 500 metadata-only events and reports truncation.
- [ ] Existing `ContextDiagnostics` values and saved chats remain backward compatible.

**Verification:**

- [ ] Contract/producer tests cover success, malformed stream, fallback, cancellation, replacement, and partial diagnostics.
- [ ] Type check proves all fields are additive and optional at the root boundary.

**Dependencies:** Tasks 5, 6, 10, 12, and 16.

**Files likely touched:** `src/shared/types.ts`, transport/parser modules, `AgentRun`, `ResearchProgressProjector`, controller/persistence modules, focused tests.

**Estimated scope:** Medium; implement as producer slices if more than five files change in one slice.

### Task 18: Build failure localization and the canonical report view model

**Description:** Add deterministic failure-localization rules and a pure `DiagnosticReportViewModel` builder that becomes the semantic source for raw, readable, and HTML representations.

**Acceptance criteria:**

- [ ] Findings distinguish transport, parser, run, projector, delivery, and persistence failures when evidence is sufficient.
- [ ] Findings contain stable severity/code/layer fields and do not claim certainty for incomplete snapshots.
- [ ] View-model section ordering, empty states, metrics, budgets, attempts, and timeline are deterministic.
- [ ] Existing canonical raw report remains available and backward compatible.

**Verification:**

- [ ] Golden fixtures cover successful, unsupported, malformed-stream, cancelled, fallback, and delivery-failure reports.
- [ ] Unit tests prove every localization rule from the diagnostic specification.

**Dependencies:** Task 17.

**Files likely touched:** `src/ui/diagnosticFormatting.ts`, new diagnostic view-model/rule module if separation is needed, `tests/unit/diagnostic-formatting.test.ts`, focused rule tests.

**Estimated scope:** Medium.

### Task 19: Render readable diagnostics and generate standalone HTML

**Description:** Render the canonical view model as safe Obsidian DOM and deterministic self-contained HTML modelled on `docs/diagnostic-report-readable.html`.

**Acceptance criteria:**

- [ ] Readable DOM and HTML expose identical semantic section IDs, values, warnings, findings, and empty states.
- [ ] Exported HTML is UTF-8, offline-readable, printable, script-free, remote-resource-free, and uses embedded static CSS.
- [ ] Every diagnostic-derived value is escaped; neither formatter performs redaction itself.
- [ ] Missing optional legacy fields render without errors.

**Verification:**

- [ ] Semantic-parity snapshots cover complete and partial reports.
- [ ] Hostile HTML and forbidden-channel sentinels are absent or escaped in raw, readable DOM, and HTML as required.

**Dependencies:** Task 18.

**Files likely touched:** `src/ui/diagnosticFormatting.ts`, new `src/ui/diagnosticHtml.ts`, new readable DOM renderer, `styles.css`, formatter/security tests.

**Estimated scope:** Medium.

### Task 20: Add readable/raw modal controls and HTML download

**Description:** Integrate readable rendering into the existing per-answer diagnostic modal with an accessible mode switch, canonical raw copy, and safe HTML download lifecycle.

**Acceptance criteria:**

- [ ] Modal opens in `Readable`; `Readable / Raw` switches without reopening and preserves independent scroll positions.
- [ ] `Copy raw report` copies identical canonical text in either mode.
- [ ] `Download readable HTML` creates `ixplorer-diagnostic-<runId-or-timestamp>.html`, triggers one download, and revokes its object URL.
- [ ] Existing Close, Escape, overlay, resize, overflow, Debug-mode, and per-message behavior remains unchanged.

**Verification:**

- [ ] Modal tests cover keyboard access, mode/scroll state, copy payload, Blob bytes/type, filename sanitation, and URL revocation.
- [ ] Manual light/dark/offline verification matches the accepted information hierarchy without changing chat styling.

**Dependencies:** Task 19.

**Files likely touched:** `src/ui/DiagnosticReportModal.ts`, download helper, `styles.css`, modal/style tests.

**Estimated scope:** Medium.

### Checkpoint: Diagnostic report

- [ ] One answer can be followed across transport, parser, run, projection, delivery, and persistence by `runId`.
- [ ] Readable, raw, and HTML reports are semantically consistent and redacted.
- [ ] Existing diagnostic reports and saved chats remain compatible.
- [ ] Focused diagnostic tests, type check, and build pass.

### Task 21: Run the cross-provider format acceptance matrix

**Description:** Validate the implementation against recorded fixtures and manual compatible endpoints grouped by response shape rather than brand.

**Acceptance criteria:**

- [ ] All parser, state, persistence, capability, and fallback matrices pass.
- [ ] Manual verification covers structured Chat Completions, Responses, inline tags, tools, and ordinary models.
- [ ] Existing chat style is unchanged outside the reasoning block.
- [ ] Known unsupported combinations degrade to final-answer streaming with actionable diagnostics.

**Verification:**

- [ ] `npm test`
- [ ] `npx tsc --noEmit`
- [ ] `npm run format`
- [ ] `npm run build` in an environment allowed to write the configured plugin target.
- [ ] Manual screenshot comparison with the supplied target/current screenshots.

**Dependencies:** Tasks 0–20.

**Files likely touched:** test fixtures, acceptance tests, documentation only unless defects are found.

**Estimated scope:** Medium.

## Final checkpoint

- [ ] Every success criterion in the specification is verified.
- [ ] All open questions have recorded decisions.
- [ ] No core stream/UI logic branches on provider brand or model name.
- [ ] Profile capability state refreshes without re-save.
- [ ] Reasoning display matches the target behavior without a chat redesign.
- [ ] Repeated reasoning/intermediate stages collapse into one `Research progress` block after finalization.
- [ ] Full review covers correctness, compatibility, security/privacy, performance, and accessibility.

## Risks and mitigations

| Risk                                                                | Impact | Mitigation                                                         |
| ------------------------------------------------------------------- | ------ | ------------------------------------------------------------------ |
| Compatible providers emit undocumented or duplicated fields         | High   | Tolerant boundary parser, precedence, diagnostics, format fixtures |
| Inline tags split across chunks or appear as legitimate answer text | High   | Incremental state machine and fixed/configured tag pairs only      |
| Reasoning continuation is corrupted during tool loops               | High   | Separate opaque state, exact ordered replay, lifecycle tests       |
| Automatic fallback duplicates a paid/visible request                | High   | Retry only before first output and only for classified errors      |
| Full transcript re-render causes flicker and lost disclosure state  | Medium | Incremental active-message patching and stable DOM tests           |
| Capability cache becomes stale or publishes to the wrong profile    | Medium | Versioned identity, TTL, cancellation, stale-result suppression    |
| Automatic probes load models or incur cost                          | High   | Metadata/passive refresh only; generation probes explicit          |
| Visible reasoning leaks into prompts or exports                     | High   | Separate storage, explicit projection functions, regression tests  |
| Provider metadata resolver leaks into core architecture             | Medium | Common resolver interface and no-match tests                       |
| Current dirty worktree overlaps implementation                      | High   | Review and checkpoint existing user changes before Task 1          |

## Parallelization opportunities

After Task 1 is accepted:

- Tasks 2 and 3 can proceed in parallel because they share only the normalized contract.
- Task 4 can proceed in parallel with Tasks 2 and 3.
- Task 10 can proceed in parallel with Tasks 8 and 9 after Task 7 stabilizes.
- Tasks 12 and 13 can proceed in parallel after Task 11.
- Diagnostics work can begin after state and capability contracts stabilize.

Tasks 5–7 and 14–16 are dependency-sensitive and should remain sequential.

## Open decisions blocking implementation

Implementation is blocked until the user confirms or changes these recommended defaults from the specification:

1. Persist visible reasoning separately, excluding it from normal prompt/copy/export paths.
2. Use one `Research progress` disclosure per assistant response; keep intermediate answers visible while running and collapse them with reasoning after finalization. **Accepted.**
3. Auto-close on first final-text delta unless the user manually chose a state.
4. `auto` sends no optional reasoning control.
5. `on` requires a known or explicitly selected outbound request dialect.
6. Permit at most one pre-output protocol/control fallback.
7. Run generation probes only through an explicit user action.
8. Allow optional metadata resolvers that cannot gate parsing.
9. Enable only the fixed default inline tag list plus explicit custom tags.
10. Defer LM Studio native `/api/v1/chat` support until the universal compatible paths are complete.
11. Make this specification authoritative over conflicting stream, persistence, protocol, and capability statements in the older tool-loop specification.
