# Implementation Plan: Reasoning-ready research tool loop

## Overview

Deliver the architecture incrementally without changing research behavior in the first iteration. Iteration 1 adds an editable eager override and the contracts/diagnostics needed for later routing. Agentic research tools, policy enforcement, and OpenAI Responses reasoning continuation are enabled only in subsequent reviewed iterations.

## Architecture decisions

- `forceEagerResearch` is a global persisted setting, defaults to `false`, remains editable, and overrides model capabilities only when enabled.
- Iteration 1 does not yet provide an agentic path. Both setting values therefore use the existing eager implementation, but only `true` represents a user-forced strategy.
- Eager and agentic executions are separate strategies selected before evidence gathering.
- OpenAI Responses is the reference reasoning implementation; Chat Completions remains the compatibility path.
- Research sources are atomic tools in agentic mode; application policy validates mandatory source use.
- Raw reasoning is never normal transcript or persisted answer content.
- Each completed changed index run produces a bounded index description; index-backed prompts receive the description of the currently selected index.

## Iteration 1 clarification review and recommendations

The following details were not explicit enough to implement consistently. Iteration 1 uses these resolutions:

1. **Iteration boundary.** “Iteration 1” means Tasks 1–5 and its checkpoint. No agentic routing, research search tools, provider payload changes, or reasoning continuation are activated.
2. **Diagnostics ownership.** `executionStrategy` belongs to `ContextDiagnostics`. Every diagnostic payload produced by an answer includes it; answers that intentionally omit context diagnostics keep the existing persisted shape. The iteration-1 values are `eager-forced` and `eager-default`; later values are additive.
3. **Description persistence.** `IndexDescription` is persisted on `IndexProfile`, while `indexUpdatedAt` is copied from the successfully committed index manifest. This keeps profile selection and prompt assembly synchronous without duplicating the description in index storage.
4. **Changed-run signal.** Description regeneration must use an explicit completed-run summary, not timestamps or `indexedFiles` heuristics. A rebuild counts as changed even for an empty vault; an incremental run counts as changed only when its committed index content changed.
5. **Freshness and failure semantics.** Freshness is established during the post-commit update: `indexUpdatedAt` comes from the committed manifest and the description becomes `current`. Do not compare it to `lastIndexedAt`, which is the later run-completion timestamp. `status: "failed"` means full sampling failed but a bounded minimal description for that completed run was stored; it is usable with a diagnostic warning. `status: "stale"` means the previous description is being replaced after a changed commit and must use an on-demand minimal description if observed before replacement completes.
6. **Deterministic bounds.** Description generation uses named constants for maximum output characters, representative paths/headings/samples, sample characters, and topic count. Truncation is deterministic and exposed in diagnostics; no random sampling is allowed.
7. **Prompt placement.** The index description is a delimited system-context section, not evidence and not user text. It is injected only for `indexOnly` and `indexAndWeb`, cannot satisfy citations, and is labelled as factual retrieval scope rather than instructions.
8. **Missing description fallback.** Research service construction computes a bounded minimal description from the selected profile metadata when no current persisted description exists. It does not perform file I/O, indexing, embedding, chat, or network requests.
9. **Future contracts.** Task 5 adds provider-neutral types only. It does not add an ignored `toolChoice` field to live `ChatRequest` payloads and does not claim capabilities on existing profiles; provider request mapping is deferred to Task 14.
10. **Compatibility.** Migration accepts absent or malformed description metadata by dropping it and using the deterministic fallback. Existing chat and index files require no schema-version change in iteration 1.

## Iteration 1: Forced eager foundation

### Task 1: Add the forced eager setting

**Description:** Add `forceEagerResearch` to persisted settings and migrations. Render an editable **Force eager research mode** toggle with a default value of `false`.

**Acceptance criteria:**

- [ ] New and migrated settings resolve `forceEagerResearch` to `false` when the field is absent.
- [ ] The settings UI allows the user to enable and disable the override.
- [ ] The description states that enabling it forces eager research for every model and that disabling it permits automatic strategy selection when agentic support becomes available.

**Verification:**

- [ ] `npm test -- tests/unit/settings.test.ts --run`
- [ ] `npm run lint`

**Dependencies:** None.

**Files likely touched:** `src/settings/settings.ts`, `src/settings/SettingsTab.ts`, `tests/unit/settings.test.ts`.

**Estimated scope:** Medium.

### Task 2: Introduce execution-strategy selection and diagnostics

**Description:** Add an internal execution strategy type and selector. In iteration 1 it resolves to `eager-forced` when the override is enabled and `eager-default` otherwise; both select the unchanged eager implementation.

**Acceptance criteria:**

- [ ] Every answer reports `executionStrategy: "eager-forced"` when the setting is enabled.
- [ ] Every answer reports `executionStrategy: "eager-default"` when the setting is disabled in iteration 1.
- [ ] `ResearchService` continues through the existing assembler, index/web pipelines, planner, and synthesis service.
- [ ] No research search tools or new `tool_choice` values are sent.

**Verification:**

- [ ] Targeted research-service and diagnostic-formatting tests pass.
- [ ] Existing research pipeline tests remain unchanged or receive additive assertions only.

**Dependencies:** Task 1.

**Files likely touched:** `src/shared/types.ts`, `src/research/ResearchService.ts`, `src/ui/diagnosticFormatting.ts`, related unit tests.

**Estimated scope:** Medium.

### Task 3: Persist deterministic index descriptions during indexing

**Description:** Extend index profile metadata with `IndexDescription`. After a successful changed index commit, build a bounded factual description locally from index scope, counts, source kinds, language inventory, representative paths/headings, and deterministically derived topics. A no-change run retains the current description without regeneration. No LLM or network service is used.

**Acceptance criteria:**

- [ ] Initial indexing, rebuild, and changed incremental runs persist a current description after commit.
- [ ] No-change runs do not rewrite the description or timestamp.
- [ ] Description failure cannot invalidate a successfully committed index and produces a deterministic fallback with diagnostics.
- [ ] Description generation performs no chat, embedding, or other network request.

**Verification:**

- [ ] Targeted indexing-service, settings migration, and index-profile tests pass.
- [ ] Tests cover stale/current transitions and bounded sampling/output.

**Dependencies:** Task 1.

**Files likely touched:** `src/indexing/FileVectorIndexFormat.ts`, `src/indexing/IndexingService.ts`, `src/main.ts`, `src/settings/settings.ts`, related tests.

**Estimated scope:** Medium.

### Task 4: Inject the selected index description into index-backed requests

**Description:** Add the current selected index description to research prompt context in `indexOnly` and `indexAndWeb`, for eager execution now and the agentic bootstrap contract later. Omit it from `none` and `webOnly`.

**Acceptance criteria:**

- [ ] Eager synthesis receives the selected index description in both index-backed modes.
- [ ] Other modes do not receive it, and switching index profiles changes the description.
- [ ] Missing/stale description uses a bounded deterministic fallback and records diagnostics.

**Verification:**

- [ ] Targeted prompt and research-service tests pass for all modes.
- [ ] Diagnostics identify description freshness and deterministic algorithm version.

**Dependencies:** Tasks 2 and 3.

**Files likely touched:** `src/research/ResearchService.ts`, `src/research/prompts.ts`, `src/shared/types.ts`, related tests.

**Estimated scope:** Medium.

### Task 5: Add future-facing provider-neutral contracts without activating them

**Description:** Define additive `ChatToolChoice`, capability, model-output-item, and continuation interfaces. Do not change provider request payloads or runtime execution in iteration 1.

**Acceptance criteria:**

- [ ] Contracts represent auto/none/required/specific choice and ordered text/reasoning/tool items.
- [ ] Existing `ChatModelProvider` callers remain source-compatible or are adapted without behavior change.
- [ ] No provider claims unsupported reasoning continuation.

**Verification:**

- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build`

**Dependencies:** Tasks 2 and 4.

**Files likely touched:** `src/shared/types.ts`, `src/client/chat/ChatModelClient.ts`, contract tests.

**Estimated scope:** Medium.

### Checkpoint: Iteration 1

- [ ] Forced eager setting is visible, persisted, defaults to false, and is editable through normal UI.
- [ ] All answers use the unchanged eager pipeline.
- [ ] Diagnostics prove which strategy ran.
- [ ] Changed indexes have bounded descriptions and every index-backed request receives the selected description.
- [ ] Full test suite, type check, build, and format check pass.
- [ ] Human review approves enabling work on agentic execution.

## Iteration 2: Agentic research tools behind an unavailable-by-default path

### Iteration 2 decisions

1. **No runtime activation.** Iteration 2 does not change `ResearchService` strategy selection, provider request payloads, `tool_choice`, or the current eager answer path. Tools are exercised through direct contract/integration tests only.
2. **Per-answer state.** Evidence and web-result registrations live in a new in-memory `ResearchEvidenceRegistry` created for one answer attempt. They are not global, persisted, or reusable by another answer.
3. **Uniform execution boundary.** Every tool returns a typed execution object; JSON serialization, output truncation, and diagnostic previews remain orchestration concerns rather than tool-specific string building.
4. **Stable evidence identity.** Index evidence uses the existing chunk ID. Web evidence uses the canonical URL-derived source ID. Repeated discoveries merge provenance instead of creating duplicate citations.
5. **Minimal index input.** Iteration 2 `search_index` accepts only bounded `query` and `limit`. Profile scope is fixed by the selected retriever; arbitrary paths, extensions, thresholds, and index IDs are deferred.
6. **No LLM query expansion.** `search_index` calls the existing hybrid retriever directly with the model-authored query and `includeWebResults: false`. It does not invoke chat-based query expansion.
7. **Two-step web access.** `search_web` calls the provider with `maxFetches: 0`. It returns bounded title/snippet metadata and opaque answer-scoped `resultId` handles. `fetch_web_page` accepts only a registered handle, never a raw model-supplied URL.
8. **SSRF boundary.** Page fetching permits HTTP(S) only, rejects credentials, localhost, loopback/link-local/private literal addresses, validates redirects, and applies timeout/content-type/size bounds. Provider implementations must fail closed when these checks cannot be enforced.
9. **Untrusted content.** Vault snippets, web snippets, and fetched pages are labelled untrusted evidence in tool results. They cannot contribute tool definitions, source policy, or executable instructions.
10. **Citation ownership.** Tools register visible evidence with the registry. Later orchestration consumes a registry snapshot to build `ResearchAnswer.evidence` and citations; it never trusts citation IDs invented in model text.
11. **Compatibility.** Existing `search_notes` remains unchanged for compatibility. It does not count as `search_index` and is not reused as the new index-tool implementation because its path-search fallback weakens mandatory index semantics.

### Task 6: Define typed research-tool execution contracts

**Description:** Introduce a provider-neutral internal tool contract with typed success/error payloads, execution metadata, and boundary validation. Keep existing `ChatToolDefinition` as the schema sent to models later, but stop requiring new tools to construct JSON strings internally.

**Acceptance criteria:**

- [ ] `ResearchToolHandler<TInput, TOutput>` exposes one definition, validated input parsing, and typed execution.
- [ ] All expected failures use `{ code, message, retryable, details? }`; thrown errors are reserved for unexpected host failures.
- [ ] Invalid names, missing fields, oversized queries, non-integer limits, and unknown properties fail deterministically without invoking a provider.

**Verification:**

- [ ] `npm test -- tests/unit/research-tool-contracts.test.ts --run`
- [ ] `npm run lint`

**Dependencies:** Iteration 1 checkpoint.

**Files likely touched:** `src/research/ResearchTools.ts`, `src/shared/types.ts`, `tests/unit/research-tool-contracts.test.ts`.

**Estimated scope:** Medium.

### Task 7: Implement the per-answer evidence registry

**Description:** Add an in-memory registry for index chunks, web snippets/pages, citations, web-result handles, and call provenance. The registry is the only component allowed to resolve `resultId` to a URL.

**Acceptance criteria:**

- [ ] Registering the same chunk or canonical web URL twice produces one evidence/citation entry with combined provenance.
- [ ] Web handles are opaque, answer-scoped, bounded in count, and rejected outside their registry instance.
- [ ] Snapshot output is immutable, deterministically ordered, and contains only registered evidence and citations.

**Verification:**

- [ ] `npm test -- tests/unit/research-evidence-registry.test.ts --run`
- [ ] Tests cover duplicate index chunks, URL canonicalization, handle isolation, and snippet-to-page upgrades.

**Dependencies:** Task 6.

**Files likely touched:** `src/research/ResearchEvidenceRegistry.ts`, `tests/unit/research-evidence-registry.test.ts`, `src/shared/types.ts`.

**Estimated scope:** Medium.

### Task 8: Implement the `search_index` vertical slice

**Description:** Implement `search_index` on top of the selected `ResearchRetriever`. Validate a non-empty query capped at 240 characters and clamp the result limit to 1–5. Return bounded snippets and register exactly the chunks visible to the model.

**Acceptance criteria:**

- [ ] The tool calls the retriever with `includeWebResults: false`, no chat query expansion, and no model-selected index/profile override.
- [ ] Internal skill paths are excluded; results contain stable evidence/chunk IDs, source metadata, score, and at most 1,000 snippet characters.
- [ ] Empty results return `ok: true` and satisfy the future mandatory-source policy; retriever failures return a uniform retryable/non-retryable error.

**Verification:**

- [ ] `npm test -- tests/unit/index-research-tool.test.ts --run`
- [ ] Tests cover limits, skill exclusion, empty results, provider failure, evidence registration, and no full-document leakage.

**Dependencies:** Tasks 6 and 7.

**Files likely touched:** `src/research/IndexResearchTool.ts`, `src/research/ResearchEvidenceRegistry.ts`, `tests/unit/index-research-tool.test.ts`, `src/research/types.ts`.

**Estimated scope:** Medium.

### Checkpoint: Index tool foundation

- [ ] Typed tool and error contracts are stable.
- [ ] Registry snapshots cannot contain unregistered citations.
- [ ] `search_index` is bounded and directly testable but absent from live model requests.
- [ ] Targeted tests and `npm run lint` pass.

### Task 9: Split web provider search from page fetching

**Description:** Add an optional page-fetch capability to the web provider boundary while preserving current eager behavior. DuckDuckGo search must support metadata-only operation through the existing `maxFetches: 0`; the new page fetch method returns bounded extracted content and final URL metadata.

**Acceptance criteria:**

- [ ] Existing eager `search(..., maxFetches > 0)` behavior remains backward compatible.
- [ ] Metadata-only search performs no result-page fetches.
- [ ] Page-fetch responses distinguish HTTP, content-type, timeout, redirect-policy, empty-content, and size/truncation outcomes.

**Verification:**

- [ ] Targeted DuckDuckGo provider and parser tests pass.
- [ ] Request-count assertions prove that metadata-only search does not fetch result pages.

**Dependencies:** Task 6.

**Files likely touched:** `src/shared/types.ts`, `src/web/DuckDuckGoSearchProvider.ts`, provider unit tests, test HTTP fixtures.

**Estimated scope:** Medium.

### Task 10: Implement the `search_web` vertical slice

**Description:** Implement bounded metadata-only web search. Register each canonical result URL and its snippet, then return an opaque `resultId` for optional page fetching.

**Acceptance criteria:**

- [ ] Query is non-empty, capped at 240 characters, and result limit is clamped to 1–5.
- [ ] The provider is always called with `maxFetches: 0`; results expose bounded title/snippet/rank/resultId and never raw fetched page content.
- [ ] Duplicate canonical URLs collapse to one result/evidence entry while retaining query/call provenance.

**Verification:**

- [ ] `npm test -- tests/unit/web-search-research-tool.test.ts --run`
- [ ] Tests cover empty results, duplicate URLs, provider failure, bounds, registration, and zero page-fetch requests.

**Dependencies:** Tasks 7 and 9.

**Files likely touched:** `src/research/WebSearchResearchTool.ts`, `src/research/ResearchEvidenceRegistry.ts`, `tests/unit/web-search-research-tool.test.ts`.

**Estimated scope:** Medium.

### Task 11: Implement secure `fetch_web_page`

**Description:** Resolve an opaque `resultId` through the current evidence registry and fetch that registered page through the provider. Add URL/redirect/response safety checks before returning bounded untrusted page text.

**Acceptance criteria:**

- [ ] Unknown, expired, cross-registry, and malformed handles fail before network access; the tool schema has no raw URL argument.
- [ ] HTTP(S), credential, private-address, redirect, timeout, content-type, and maximum-response policies fail closed with uniform errors.
- [ ] Successful fetch upgrades the registered web evidence from snippet to bounded page content without changing its citation identity.

**Verification:**

- [ ] `npm test -- tests/unit/web-fetch-research-tool.test.ts --run`
- [ ] Tests cover localhost/private literals, credentials, redirect rejection, binary responses, timeout, truncation, handle isolation, and prompt-like page content remaining data.

**Dependencies:** Tasks 7, 9, and 10.

**Files likely touched:** `src/research/WebFetchResearchTool.ts`, `src/web/WebUrlPolicy.ts`, `src/research/ResearchEvidenceRegistry.ts`, related tests.

**Estimated scope:** Medium.

### Checkpoint: Web tools

- [ ] Search and fetch are observably separate operations.
- [ ] The model cannot cause an arbitrary URL fetch.
- [ ] Fetched text is bounded, registered, citation-safe, and labelled untrusted.
- [ ] Existing eager web regression tests still pass.

### Task 12: Generalize the tool registry without breaking note tools

**Description:** Introduce a registry that composes note, skill, index, and web handlers, rejects duplicate names, filters definitions by an explicit availability policy, and dispatches through the typed execution boundary. Adapt existing note-tool results at the registry edge without changing their public schemas.

**Acceptance criteria:**

- [ ] Duplicate tool names fail during registry construction; unknown tools return one uniform error.
- [ ] Availability can represent search mode, active-file access, web-provider presence, retriever presence, and skill availability without reading global UI state inside handlers.
- [ ] Existing `read_note`, `search_notes`, `list_notes`, `get_active_note`, and one-skill validation tests remain behaviorally compatible.

**Verification:**

- [ ] `npm test -- tests/unit/research-tool-registry.test.ts tests/unit/note-tools.test.ts --run`
- [ ] `npm run lint`

**Dependencies:** Tasks 8, 10, and 11.

**Files likely touched:** `src/research/ResearchToolRegistry.ts`, `src/research/NoteTools.ts`, registry tests, `tests/unit/note-tools.test.ts`.

**Estimated scope:** Medium.

### Task 13: Assemble inactive agentic dependencies and prove isolation

**Description:** Add a factory that can create a fresh evidence registry and research-tool registry for a future answer attempt, but do not connect it to `ToolLoopRunner` or live provider requests. Add regression assertions that iteration-2 tools stay inactive for both eager strategies.

**Acceptance criteria:**

- [ ] Factory output contains only tools permitted by its explicit test policy and owns a fresh evidence registry.
- [ ] Live requests in `eager-forced` and `eager-default` contain no `search_index`, `search_web`, or `fetch_web_page` definitions.
- [ ] No `toolChoice` field or reasoning continuation is added to provider payloads in iteration 2.

**Verification:**

- [ ] Targeted factory, research-service, and chat-model-client payload tests pass.
- [ ] `npm test`, `npm run lint`, `npm run build`, and `npm run format` pass.

**Dependencies:** Task 12.

**Files likely touched:** `src/research/createResearchToolRegistry.ts`, `src/main.ts`, factory tests, existing request regression tests.

**Estimated scope:** Medium.

### Checkpoint: Iteration 2 complete

- [ ] Index/web/page/note tools share one validated dispatch contract.
- [ ] Evidence and citations are stable, bounded, deduplicated, and answer-scoped.
- [ ] Web fetch cannot escape registered search results and passes SSRF/content safety tests.
- [ ] All new tools are integration-tested without changing production answer routing.
- [ ] Existing eager behavior and provider payloads remain unchanged.
- [ ] Full test suite, type check, build, and format check pass.
- [ ] Human review approves tool-choice and policy-loop work in iteration 3.

## Iteration 3: Policy-controlled agentic loop

### Task 14: Add tool-choice mappings and capability validation

Implement provider-neutral choice mapping for providers that can prove required/specific behavior. Unsupported mappings fail closed.

### Task 15: Implement bootstrap policy and repair state machine

Compute mandatory tools from search mode and active-file setting, validate first-round calls, allow one repair round, and enforce budgets and duplicate caching.

### Task 16: Add clean deterministic fallback

Restart from a clean eager state on unsupported capabilities, malformed calls, mandatory failures, or exhausted limits. Record fallback and duplicated-cost diagnostics.

### Task 17: Activate automatic agentic selection when eager is not forced

Keep the existing setting editable. When it is `false`, select agentic execution if capabilities suffice and deterministic eager fallback otherwise. When it is `true`, bypass capability-based selection and use eager execution for every model.

### Checkpoint: Agentic loop

- [ ] Mandatory-source matrix passes for every search mode and active-file combination.
- [ ] Missing calls are repaired once or trigger fallback.
- [ ] Final citations refer only to registered tool evidence.
- [ ] Re-enabling forced eager immediately restores the original pipeline.

## Iteration 4: OpenAI Responses reasoning reference

### Task 18: Implement ordered Responses output and continuation

Parse text, reasoning, and function-call items in order. Preserve opaque response continuation within one answer loop.

### Task 19: Add reasoning profile controls and capability probing

Add per-profile reasoning effort, combined metadata/probe/manual capability resolution, and conservative migration defaults.

### Task 20: Add reasoning-safe streaming and diagnostics

Render tool statuses and optional summaries while excluding raw reasoning from transcript, history, exports, and persisted answers.

### Checkpoint: Reasoning support

- [ ] Tool rounds preserve Responses continuation.
- [ ] Raw reasoning never enters user content or storage.
- [ ] Forced eager remains an immediate compatibility override.
- [ ] Saved conversations remain backward compatible.

## Iteration 5: Additional providers and deep research

- Specify and implement Anthropic reasoning signatures/continuation.
- Specify and implement Ollama reasoning behavior only where the server exposes a stable contract.
- Define agentic `deepResearch` limits, source policy, and termination separately.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| New contracts accidentally alter current answers | High | Iteration 1 keeps the existing eager implementation for both setting values and adds payload/evidence regression tests |
| Description is stale or misleading | High | Bind it to index timestamps/counts, regenerate only after commit, expose freshness, retain deterministic fallback |
| Description generation adds indexing cost | Medium | Local bounded representative sampling, deterministic topic extraction, and no regeneration for no-change runs |
| Provider advertises tools but ignores choice | High | Capability validation, one repair, then clean fallback |
| Reasoning state is flattened into text | High | Opaque continuation and ordered output items; storage exclusion tests |
| Tool loop increases latency/cost | Medium | Parallel first calls, strict budgets, cache duplicates, forced eager override |
| Web/vault prompt injection | High | Treat results as untrusted evidence and validate all citations |
| Web result enables SSRF on page fetch | High | Answer-scoped opaque handles, URL/redirect policy, private-address rejection, and fail-closed provider boundary |
| Partial agentic run duplicates work on fallback | Medium | Explicit diagnostics and clean, non-mixed fallback state |

## Verification commands

```bash
npm test
npm run lint
npm run build
npm run format
```

## Deferred decisions

- Agentic `deepResearch` behavior.
- Anthropic versus Ollama rollout priority after OpenAI Responses.
- Exact reasoning-effort options exposed by model profile.
