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

### Iteration 2 clarification review and recommendations

The implementation uses these resolutions for details that were not explicit enough in the original task descriptions:

1. **Input normalization.** A missing result limit defaults to 5. Integer limits are clamped to 1–5; non-numeric and non-integer limits fail validation. Queries are whitespace-normalized, must remain non-empty, and fail when they exceed 240 characters. They are never silently truncated. New tool schemas reject unknown properties with `additionalProperties: false`.
2. **URL canonicalization.** Canonical web URLs lower-case the scheme and hostname, remove credentials, fragments, and default ports, and preserve path and query ordering. Tracking parameters are not removed because doing so can change resource identity.
3. **Evidence identity and merging.** Index evidence uses the existing chunk ID. Web evidence derives its ID from the canonical registered URL. Duplicate discoveries retain one citation and merge call/query provenance. Fetching a page upgrades its snippet evidence without changing its evidence or citation ID.
4. **Answer-scoped handles.** Web result handles are random opaque identifiers stored only by one `ResearchEvidenceRegistry`. Snapshot ordering depends on evidence registration, not handle values, and snapshots are detached and deeply frozen.
5. **Fetch defaults.** Page fetch permits HTTP(S) without credentials; rejects localhost and private, loopback, link-local, multicast, unspecified, and reserved literal IP addresses; validates every redirect manually; uses a 30-second timeout; accepts HTML and plain text; caps raw response bytes at 1 MiB and extracted text at 16,000 characters.
6. **Retry semantics.** Network errors, timeouts, HTTP 429, and HTTP 5xx are retryable. Input, handle, URL-policy, content-type, redirect-policy, size, and other HTTP 4xx failures are non-retryable.
7. **DNS limitation before activation.** Browser `fetch` does not expose the connected IP address, so a hostname that resolves to a private address cannot be proven safe against DNS rebinding at this boundary. Iteration 2 therefore remains unavailable at runtime. Activation requires a resolver-aware transport or an explicit trusted-host policy; iteration 2 does not claim complete hostname-level SSRF enforcement.
8. **Redirect identity.** A fetched final URL is retained as metadata. The citation continues to use the canonical URL registered by `search_web`, preserving stable identity across redirects.
9. **Note-tool compatibility.** The typed registry adapts existing note-tool JSON at its edge and preserves existing schemas and the successful `no-active-note` execution semantics. Existing note tools are not retrofitted with stricter argument validation in this iteration.
10. **Inactive assembly.** The iteration-2 factory is a standalone dependency-assembly boundary used by direct tests. It is not instantiated from `main.ts`, `ResearchService`, `ToolLoopRunner`, or a provider adapter.

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

**Files likely touched:** `src/research/tools/ResearchTools.ts`, `src/shared/types.ts`, `tests/unit/research-tool-contracts.test.ts`.

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

**Files likely touched:** `src/research/tools/ResearchEvidenceRegistry.ts`, `tests/unit/research-evidence-registry.test.ts`, `src/shared/types.ts`.

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

**Files likely touched:** `src/research/tools/IndexResearchTool.ts`, `src/research/tools/ResearchEvidenceRegistry.ts`, `tests/unit/index-research-tool.test.ts`, `src/research/types.ts`.

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

**Files likely touched:** `src/research/tools/WebSearchResearchTool.ts`, `src/research/tools/ResearchEvidenceRegistry.ts`, `tests/unit/web-search-research-tool.test.ts`.

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

**Files likely touched:** `src/research/tools/WebFetchResearchTool.ts`, `src/web/WebUrlPolicy.ts`, `src/research/tools/ResearchEvidenceRegistry.ts`, related tests.

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

**Files likely touched:** `src/research/tools/ResearchToolRegistry.ts`, `src/research/tools/NoteTools.ts`, registry tests, `tests/unit/note-tools.test.ts`.

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

**Files likely touched:** `src/research/tools/createResearchToolRegistry.ts`, `src/main.ts`, factory tests, existing request regression tests.

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

### Iteration 3 provider constraints

The implementation must follow these documented provider semantics:

- OpenAI Chat Completions supports `auto`, `none`, `required`, a forced function object, and `parallel_tool_calls`. Forced-function wire shape is `{ "type": "function", "function": { "name": "..." } }`. Source: https://platform.openai.com/docs/api-reference/chat/create-chat-completion
- OpenAI recommends strict schemas; iteration-2 schemas already use `additionalProperties: false`, but optional properties prevent blindly adding `strict: true` until schemas are normalized. Source: https://developers.openai.com/api/docs/guides/function-calling
- Anthropic maps neutral choices to `auto`, `none`, `any`, and `{ type: "tool", name }`. Forced `any/tool` choices are incompatible with extended thinking, so iteration 3 may use them only while reasoning is disabled. Source: https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools
- Ollama documents tool calling and tool-result loops but does not document `tool_choice`; required/specific choice must be treated as unsupported in iteration 3. Source: https://docs.ollama.com/capabilities/tool-calling

### Iteration 3 decisions

1. **Strategy precedence.** `forceEagerResearch: true` always selects `eager-forced`. `deepResearch: true` remains on the existing eager path. Otherwise agentic execution requires tools plus every choice capability needed by the request policy; ineligible profiles select `deterministic-fallback` before making an agentic request.
2. **Conservative migration.** Existing `capabilities.tools` migrates to `toolCalling.calls`; `choiceRequired`, `choiceSpecific`, and `parallelCalls` default to `false`. No existing OpenAI-compatible profile is optimistically upgraded.
3. **Capability provenance.** Persist effective tool-control flags with per-group source `format-default | probe | manual`. A manual override wins over probe, and probe wins over format default. Unsupported mappings fail before network execution.
4. **Provider defaults.** Ollama required/specific are false. Anthropic and OpenAI-compatible wire mappings exist, but a profile becomes agentic only after verified probe or explicit manual enablement. This avoids assuming every compatible server/model implements the documented upstream API.
5. **Bootstrap choice.** With one mandatory tool, the first request uses `specific`. With multiple mandatory tools, it uses `required` and requests parallel calls when supported. With no mandatory tools, it uses `auto`.
6. **One repair round.** After the bootstrap response, exactly one missing or retryable-failed mandatory tool may be forced with `specific`. More than one unresolved mandatory tool, an unavailable specific choice, or a failed repair triggers clean fallback.
7. **Satisfaction semantics.** Successful empty `search_index`/`search_web` results satisfy policy. `get_active_note` returning `no-active-note` satisfies policy with a warning. A tool call request alone never satisfies policy; execution must complete with an accepted result.
8. **Buffered text.** Text from bootstrap, repair, or any round containing tool calls is buffered and discarded. Only a terminal round produced after policy satisfaction may emit user-visible deltas.
9. **Agentic context.** Explicitly attached files remain eager context. Active-file content, index retrieval, web retrieval, and graph expansion are absent from the initial agentic prompt. Index description remains system retrieval-scope metadata in index-backed modes.
10. **Tool availability.** Registry definitions are computed once per answer from search mode and available dependencies. `search_index` is absent outside index modes; web tools are absent outside web modes; `get_active_note` is available when active access exists; skill loading is available in every mode.
11. **Evidence ownership.** Agentic success combines explicit attached evidence with the answer-scoped registry snapshot. Citations are built only from those sources. Unknown citation IDs in model text produce diagnostics and never create citation objects.
12. **Clean fallback.** Agentic failure emits no text delta and discards its registry. The eager pipeline restarts from the original request. Final diagnostics use `deterministic-fallback` and retain a bounded agentic-attempt summary without copying tool content.
13. **Legacy loop isolation.** The current note/skill `ToolLoopRunner` remains the eager compatibility path. Agentic execution gets a separate state-machine runner; do not expand the legacy runner into two incompatible responsibilities.
14. **Budgets.** Five model rounds, one repair round, five calls per round, ten calls total, 50,000 cumulative serialized result characters, one retry per retryable mandatory call, and duplicate-call result caching by normalized tool name+arguments.

### Iteration 3 clarification review and recommendations

The following implementation details were still ambiguous after comparing the plan with the current code and provider documentation. Iteration 3 uses these resolutions:

1. **Per-capability provenance.** Required-choice, specific-choice, and parallel-call values are resolved independently. Each effective flag records its own `format-default | probe | manual` source; manual values override probe results, and probe results override conservative format defaults.
2. **Parallel bootstrap eligibility.** Policies with two or more mandatory tools require verified or manually enabled parallel-call support. Without it the bounded bootstrap/repair contract cannot guarantee all mandatory independent calls, so the request selects deterministic fallback before an agentic network call.
3. **Probe isolation.** Capability probing is an explicit action on a saved chat profile. It uses only synthetic tool definitions and a synthetic prompt, never vault, index, web, note, attachment, history, or skill content. Probe updates detected values only and does not overwrite manual values.
4. **Cooperative cancellation.** User cancellation is propagated with `AbortSignal` through research, model, HTTP, and tool boundaries. The existing UI-only loop break is insufficient because it leaves requests running.
5. **No-source eligibility.** A policy with no mandatory source still requires verified tool-calling support because the agentic path may expose skill/note tools. Profiles without verified calls use deterministic fallback.
6. **Cancellation terminal behavior.** Explicit user cancellation terminates the answer without starting eager fallback. Other terminal agentic failures restart the clean eager path. This prevents a stop action from triggering a second model request.

### Task 14: Persist tool-control capabilities and manual overrides

**Description:** Extend chat model capability persistence and settings UI with required, specific, and parallel tool-control flags plus provenance. Preserve the existing Tools toggle as the top-level `calls` switch and migrate all new flags conservatively to false.

**Acceptance criteria:**

- [ ] Existing profiles retain their current `tools` behavior while new required/specific/parallel flags default to false.
- [ ] Settings explain that required and specific choice are necessary for agentic research; users can explicitly override detected values.
- [ ] Effective capability resolution is deterministic and records `format-default`, `probe`, or `manual` provenance.

**Verification:**

- [ ] Targeted settings migration, profile modal, and capability-resolution tests pass.
- [ ] `npm run lint`

**Dependencies:** Iteration 2 checkpoint.

**Files likely touched:** `src/settings/settings.ts`, `src/settings/SettingsTab.ts`, `src/settings/toolCapabilities.ts`, related tests.

**Estimated scope:** Medium.

### Task 15: Add explicit tool-control capability probes

**Description:** Add an opt-in profile action that probes harmless synthetic tools for required and specific choice. Probe results update detected capability state but never override explicit manual settings. Parallel calls remain manual/format-derived because model output cannot reliably prove them.

**Acceptance criteria:**

- [ ] Required probe succeeds only when the provider accepts the mapped request and returns at least one valid synthetic tool call.
- [ ] Specific probe succeeds only when the requested synthetic tool name is returned; ordinary text or another tool fails the probe.
- [ ] Probe errors, malformed arguments, refusal, timeout, and unsupported provider mapping fail closed without changing manual overrides.

**Verification:**

- [ ] Targeted probe tests cover OpenAI-compatible and Anthropic request/response fixtures plus Ollama unsupported behavior.
- [ ] No probe invokes vault, index, web, or note tools.

**Dependencies:** Task 14.

**Files likely touched:** `src/settings/toolCapabilityProbe.ts`, `src/settings/SettingsTab.ts`, `src/client/chat/ChatModelClient.ts`, related tests.

**Estimated scope:** Medium.

### Task 16: Map neutral `toolChoice` into provider payloads

**Description:** Activate additive `toolChoice` and `parallelToolCalls` request fields and map them in each provider adapter. Validate a specific tool name against definitions before sending. Do not add reasoning continuation in this iteration.

**Acceptance criteria:**

- [ ] OpenAI-compatible emits documented Chat Completions shapes for auto/none/required/specific and `parallel_tool_calls` only when supplied.
- [ ] Anthropic emits auto/none/any/tool shapes and rejects forced choices when effective reasoning is enabled.
- [ ] Ollama accepts only auto/none behavior needed by legacy calls; required/specific mapping returns a local unsupported-capability error before HTTP.

**Verification:**

- [ ] Provider payload contract tests cover every neutral choice and prove unsupported values are not silently dropped.
- [ ] Existing requests with no `toolChoice` remain byte-shape compatible apart from intentional JSON property ordering.

**Dependencies:** Tasks 14 and 15.

**Files likely touched:** `src/shared/types.ts`, `src/client/chat/ChatModelClient.ts`, `tests/unit/chat-model-client.test.ts`, provider contract tests.

**Estimated scope:** Medium.

### Checkpoint: Provider control

- [ ] Profile capabilities are conservative, explainable, and user-overridable.
- [ ] Required/specific probes cannot touch user data.
- [ ] Every supported neutral choice has exact request-fixture coverage.
- [ ] Ollama and unverified compatible servers fail closed to eager fallback.

### Task 17: Implement strategy eligibility and mandatory-source policy

**Description:** Replace the iteration-1 binary selector with a pure strategy/policy resolver. Inputs include forced eager, deep research, search mode, active-file inclusion, dependency availability, effective tool capabilities, and selected model/provider.

**Acceptance criteria:**

- [ ] It computes exact mandatory tool names for every search-mode/active-file combination.
- [ ] Forced eager wins unconditionally; deep research remains eager; missing tools or choice capabilities resolve to bounded `deterministic-fallback` reasons.
- [ ] One mandatory tool requires specific choice; multiple require required choice; no mandatory tools allow auto.

**Verification:**

- [ ] Table-driven tests cover every mode, active-file flag, capability combination, and missing dependency.
- [ ] Resolver performs no I/O and returns immutable policy data.

**Dependencies:** Task 16.

**Files likely touched:** `src/research/ResearchExecutionPolicy.ts`, `src/shared/types.ts`, `tests/unit/research-execution-policy.test.ts`.

**Estimated scope:** Medium.

### Task 18: Build the agentic prompt and explicit-context preparation

**Description:** Add a separate agentic prompt path. Assemble explicitly attached/mentioned context within budget, but omit active-file content, eager index/web retrieval, graph expansion, and “no evidence found” wording. Include index description and mandatory-tool policy as trusted system instructions.

**Acceptance criteria:**

- [ ] Initial agentic messages contain question/history, bounded explicit context, skill catalog, index description when applicable, and exact mandatory source names.
- [ ] Active-note text and eager index/web/graph evidence are absent before tool execution.
- [ ] Explicit evidence retains citation IDs and prompt-injection delimiters; agentic token estimation includes tools, policy, skill catalog, and index description.

**Verification:**

- [ ] Prompt snapshot tests cover all modes, active-file flag, attachments, skills, and malicious delimited content.
- [ ] Existing eager prompt snapshots remain unchanged.

**Dependencies:** Task 17.

**Files likely touched:** `src/research/agenticPrompts.ts`, `src/research/ContextAssembler.ts`, `src/research/prompts.ts`, related tests.

**Estimated scope:** Medium.

### Task 19: Implement the agentic state-machine runner

**Description:** Create a new runner with bootstrap, repair, research, complete, and fallback phases. It owns the answer-scoped tool/evidence registry, buffers non-terminal text, executes bounded tool calls, caches duplicates, and validates mandatory execution outcomes.

**Acceptance criteria:**

- [ ] Bootstrap uses policy-selected choice; unresolved policy follows the one-repair rule exactly.
- [ ] Only a policy-satisfied terminal round can return final text; intermediate text is never emitted or appended to the final answer.
- [ ] Round/call/result budgets, cancellation, duplicate caching, retryable failure, malformed calls, and model stop reasons produce deterministic terminal outcomes.

**Verification:**

- [ ] State-transition tests cover success, parallel calls, empty results, no-active-note, one repair, multiple missing calls, retries, duplicates, limits, cancellation, and premature text.
- [ ] The existing eager `ToolLoopRunner` tests remain unchanged.

**Dependencies:** Tasks 17 and 18.

**Files likely touched:** `src/research/AgenticResearchRunner.ts`, `src/research/ResearchExecutionPolicy.ts`, `src/research/tools/ResearchToolRegistry.ts`, related tests.

**Estimated scope:** Medium.

### Checkpoint: Agentic state machine

- [ ] Source policy cannot be satisfied by prompt compliance or an unexecuted call.
- [ ] No partial agentic answer text reaches the transcript.
- [ ] Exactly one repair round is enforced.
- [ ] Budgets and fallback reasons are machine-readable.

### Task 20: Finalize agentic evidence, citations, skills, and diagnostics

**Description:** Convert explicit evidence plus the registry snapshot into a `ResearchAnswer`. Preserve the one-skill contract, audit model citation IDs against registered evidence, and add bounded agentic diagnostics without persisting private tool content.

**Acceptance criteria:**

- [ ] Evidence/citations are deduplicated, deterministic, and contain no unregistered model-supplied source.
- [ ] Explicit or automatic skill selection still permits at most one successfully loaded skill in every search mode.
- [ ] Diagnostics record policy, phases, tool outcomes, repairs, budgets, unknown citation IDs, and capability provenance without full page/note contents.

**Verification:**

- [ ] Tests cover citation hallucination, repeated evidence, skill success/failure/multiple-skill rejection, and diagnostic redaction.
- [ ] Chat persistence and answer-note formatting remain backward compatible.

**Dependencies:** Task 19.

**Files likely touched:** `src/research/AgenticAnswerFinalizer.ts`, `src/shared/types.ts`, `src/research/AnswerSynthesisService.ts`, related tests.

**Estimated scope:** Medium.

### Task 21: Add clean eager fallback orchestration

**Description:** Add an answer-level coordinator that selects eager or agentic before retrieval. On agentic terminal failure, discard its registry and buffered text, then restart the existing eager pipeline from the original request while retaining only a bounded attempt summary.

**Acceptance criteria:**

- [ ] Capability-ineligible requests enter eager without an agentic network call; attempted agentic failures restart from clean request state.
- [ ] Partial agentic evidence, citations, messages, and text never enter fallback synthesis.
- [ ] Final strategy is `eager-forced`, `eager-default`, `agentic`, or `deterministic-fallback` with a stable reason and duplicated-cost indicator.

**Verification:**

- [ ] Tests prove clean fallback after malformed calls, missing mandatory calls, tool failure, context limit, cancellation boundary, and provider error.
- [ ] Eager-only regression fixtures remain unchanged when forced eager is enabled.

**Dependencies:** Tasks 19 and 20.

**Files likely touched:** `src/research/ResearchAnswerCoordinator.ts`, `src/research/ResearchService.ts`, `src/research/AnswerSynthesisService.ts`, related tests.

**Estimated scope:** Medium.

### Task 22: Activate agentic routing and complete end-to-end verification

**Description:** Wire the iteration-2 registry factory into the coordinator. When eager is not forced and policy/capabilities are eligible, execute agentic research; otherwise preserve the current eager behavior. Add status/diagnostic presentation without exposing intermediate text.

**Acceptance criteria:**

- [ ] Eligible profiles use agentic execution in all supported search modes; toggling forced eager immediately bypasses it.
- [ ] Index/web/active mandatory matrix is enforced end-to-end and index description reaches the first index-backed agentic request.
- [ ] Provider payloads, chat UI, cancellation, persisted answers, citations, and fallback diagnostics behave consistently.

**Verification:**

- [ ] End-to-end fake-provider fixtures cover OpenAI-compatible and Anthropic agentic success/fallback; Ollama remains eager fallback.
- [ ] `npm test`, `npm run lint`, `npm run build`, and `npm run format` pass.

**Dependencies:** Task 21.

**Files likely touched:** `src/main.ts`, `src/research/ResearchService.ts`, `src/ui/diagnosticFormatting.ts`, integration tests.

**Estimated scope:** Medium.

### Checkpoint: Iteration 3 complete

- [ ] Tool-control support is verified or manually declared; unsupported providers fail closed.
- [ ] Mandatory-source policy is enforced by executed outcomes, not prompt instructions.
- [ ] Agentic success produces only registered evidence/citations and one terminal streamed answer.
- [ ] Agentic failure cleanly restarts eager without leaking partial text/evidence.
- [ ] Forced eager remains an immediate global override.
- [ ] Deep research remains on the existing eager path.
- [ ] Full test suite, type check, build, and format check pass.
- [ ] Human review approves reasoning-continuation work in iteration 4.

## Iteration 4: OpenAI Responses reasoning reference

### Iteration 4 decisions

1. **Provider scope.** OpenAI Responses is the only reasoning-continuation implementation activated in this iteration. Anthropic and Ollama retain their iteration-3 behavior.
2. **Protocol is model-profile data.** Add `apiProtocol: "chat-completions" | "responses"` to OpenAI-compatible chat profiles instead of adding another `ApiFormat`. Existing and malformed profiles migrate to `chat-completions`; Responses is opt-in or probe-confirmed and is never inferred solely from an OpenAI-compatible base URL.
3. **Separate model-round boundary.** Introduce a provider-neutral ordered round interface beside `ChatModelProvider`. Do not flatten Responses reasoning/function-call items into `ChatMessage`, and do not make the agentic runner parse provider SSE.
4. **Stateless continuation.** Responses requests use `store: false` and request `reasoning.encrypted_content`. The adapter passes the provider output items required for continuation back unchanged with `function_call_output` items. `previous_response_id` and server-side stored conversation state are deferred.
5. **Answer-scoped opaque state.** Response IDs, encrypted reasoning, and provider output items exist only in memory for one answer attempt. They are cleared on completion, fallback, error, or cancellation and are never written to chat history, answer notes, settings, logs, or diagnostics.
6. **Reasoning settings.** A Responses profile may enable reasoning, choose an effort from the profile's verified/manual allowed set, and request provider summary `off | auto`. Defaults are reasoning disabled, provider-default effort, and summary off.
7. **Effort is capability constrained.** The application does not assume one universal effort enum. The UI exposes only values declared by trusted metadata, a successful probe, or an explicit manual override; an unavailable value fails closed before a request.
8. **Eager is orthogonal to reasoning.** `forceEagerResearch` still forces deterministic evidence collection, but it does not disable the selected Responses protocol or reasoning during synthesis. Both eager synthesis and agentic research therefore use the same round abstraction.
9. **No raw chain-of-thought.** Only provider-generated summaries may produce ephemeral UI status events. Raw reasoning text and encrypted content never become assistant text. Only terminal output text is eligible for persistence.
10. **Fallback boundary.** A Responses parse, continuation, capability, or budget failure discards the entire answer-scoped continuation. Research fallback remains clean; it may make a fresh Responses synthesis request when the profile is otherwise usable.

### Task 23: Add protocol and reasoning profile contracts

**Description:** Add the profile-level API protocol and reasoning configuration/capability contracts with conservative migration. Keep all existing profiles on Chat Completions until Responses is explicitly selected and supported.

**Acceptance criteria:**

- [ ] OpenAI-compatible chat profiles distinguish `chat-completions` from `responses`; Anthropic and Ollama cannot select Responses.
- [ ] Existing profiles migrate without changing request URLs or payloads.
- [ ] Reasoning configuration represents enabled state, provider-default or selected effort, and summary `off | auto` separately from verified/manual capabilities.
- [ ] Unsupported protocol/effort combinations fail validation and never silently downgrade a live request.

**Verification:**

- [ ] Settings migration and validation tests cover absent, malformed, unsupported, and manually overridden fields.
- [ ] Existing Chat Completions/Anthropic/Ollama payload snapshots remain unchanged.

**Dependencies:** Iteration 3 checkpoint.

**Files likely touched:** `src/settings/settings.ts`, `src/shared/types.ts`, `src/client/chat/ChatModelCapabilities.ts`, related tests.

**Estimated scope:** Medium.

### Task 24: Introduce the ordered model-round interface

**Description:** Define `ModelRoundProvider` and ordered delta/result contracts for visible text, provider summaries, tool calls, usage, and opaque continuation. Add a Chat Completions adapter over the existing stream so current callers can migrate without behavior change.

**Acceptance criteria:**

- [ ] A round result preserves output-item and tool-call ordering and returns continuation separately from visible content.
- [ ] Only the provider adapter can inspect opaque continuation; orchestration can retain, return, or dispose it.
- [ ] The Chat Completions adapter reproduces current text/tool behavior and never claims reasoning continuation.
- [ ] Cancellation disposes incomplete round state and produces no terminal assistant text.

**Verification:**

- [ ] Contract tests cover interleaved text/tool deltas, parallel tool calls, malformed sequences, usage, and abort.
- [ ] Existing `streamChat` tests remain valid during the compatibility transition.

**Dependencies:** Task 23.

**Files likely touched:** `src/client/chat/ModelRoundProvider.ts`, `src/client/chat/ChatCompletionsRoundAdapter.ts`, `src/shared/types.ts`, related tests.

**Estimated scope:** Medium.

### Task 25: Implement the Responses HTTP and SSE adapter

**Description:** Implement `/responses` request mapping and ordered SSE parsing for messages/instructions, function tools, tool choice, parallel calls, output text, reasoning summaries, usage, incomplete status, and provider errors. Keep routing inactive until continuation tests pass.

**Acceptance criteria:**

- [ ] Requests use Responses-native tool and `tool_choice` shapes rather than Chat Completions nesting.
- [ ] The parser assembles `function_call` items by `call_id`, preserves provider order, and rejects missing IDs, invalid arguments, unknown terminal states, and truncated streams.
- [ ] Requests use `store: false`; reasoning requests include `reasoning.encrypted_content` and send configured effort/summary only when supported.
- [ ] Raw SSE events, encrypted content, and response bodies are excluded from normal logging and diagnostic previews.

**Verification:**

- [ ] Recorded contract fixtures cover text-only, one/parallel function calls, reasoning summary, incomplete response, provider error, disconnect, and cancellation.
- [ ] URL/base-path and authentication behavior matches the existing OpenAI-compatible client.

**Dependencies:** Tasks 23 and 24.

**Files likely touched:** `src/client/chat/OpenAiResponsesClient.ts`, `src/client/chat/OpenAiResponsesStreamParser.ts`, `src/client/http/ProviderHttpClient.ts`, related tests.

**Estimated scope:** Large.

### Checkpoint: Responses transport

- [ ] Existing protocols are byte-for-byte compatible at their payload boundary.
- [ ] Responses text and tool calls are parsed in provider order.
- [ ] No live profile routes through Responses yet.
- [ ] Redaction tests prove opaque continuation cannot enter logs or persistence.

### Task 26: Implement stateless encrypted reasoning continuation

**Description:** Build answer-scoped Responses continuation from ordered provider output items. On a tool round, return required reasoning/function-call items unchanged and append matching `function_call_output` items without using `previous_response_id`.

**Acceptance criteria:**

- [ ] Every continuation request includes the prior output items required by the provider and exactly one output per executed `call_id`.
- [ ] Parallel outputs retain stable association regardless of tool completion order.
- [ ] Continuation cannot cross answer attempts, retries that start clean, persisted turns, or provider/profile changes.
- [ ] Missing encrypted reasoning for a reasoning tool round fails closed instead of flattening or omitting state.

**Verification:**

- [ ] Multi-round fixtures cover reasoning + function call + output + final text, parallel calls, repair rounds, duplicate-cache results, cancellation, and clean restart.
- [ ] Serialization guards reject continuation data in persisted chat/answer/settings structures.

**Dependencies:** Task 25.

**Files likely touched:** `src/client/chat/OpenAiResponsesContinuation.ts`, `src/client/chat/OpenAiResponsesClient.ts`, `src/shared/types.ts`, related tests.

**Estimated scope:** Large.

### Task 27: Move the agentic loop to the model-round boundary

**Description:** Replace provider-stream parsing inside `AgenticResearchRunner` with `ModelRoundProvider`. Preserve iteration-3 bootstrap, repair, mandatory-source, retry, duplicate, budget, citation, and fallback semantics.

**Acceptance criteria:**

- [ ] Chat Completions agentic fixtures produce the same calls, answers, and fallback reasons as before the refactor.
- [ ] Responses continuation survives bootstrap, repair, research, and final rounds without entering the runner's message transcript.
- [ ] Only terminal visible text is released after source/citation validation; intermediate text remains buffered and discardable.
- [ ] Reasoning usage counts toward output/context budget diagnostics and incomplete responses trigger a stable fallback reason.

**Verification:**

- [ ] Run the complete iteration-3 state-machine suite against both the Chat Completions adapter and Responses fixtures.
- [ ] Tests cover forced/specific tool choice under reasoning, malformed continuation, budget exhaustion, abort, and clean eager fallback.

**Dependencies:** Tasks 24 and 26.

**Files likely touched:** `src/research/AgenticResearchRunner.ts`, `src/research/ResearchService.ts`, `src/client/chat/ModelRoundProvider.ts`, related tests.

**Estimated scope:** Large.

### Task 28: Move eager synthesis and the legacy note/skill loop to model rounds

**Description:** Adapt `AnswerSynthesisService` and its existing note/skill tool loop to the same round boundary so forced eager and deterministic fallback can still use Responses reasoning safely.

**Acceptance criteria:**

- [ ] `forceEagerResearch` changes evidence acquisition only; a Responses profile can reason during eager synthesis.
- [ ] Existing note/skill contracts, one-skill rule, active/explicit context, citations, and streaming behavior remain unchanged.
- [ ] A fallback after an agentic failure creates a new continuation scope and never reuses agentic output items.
- [ ] Chat Completions eager regression fixtures remain unchanged.

**Verification:**

- [ ] Tests cover Responses eager text-only synthesis, note/skill tool rounds, forced eager, agentic-to-eager fallback, and abort.
- [ ] Persistence tests confirm only final visible output and existing evidence/citation data are stored.

**Dependencies:** Tasks 24 and 26.

**Files likely touched:** `src/research/AnswerSynthesisService.ts`, `src/research/tools/ToolLoopRunner.ts`, `src/research/ResearchService.ts`, related tests.

**Estimated scope:** Large.

### Checkpoint: Unified reasoning loop

- [ ] Agentic and eager strategies share one ordered round contract.
- [ ] Forced eager does not disable reasoning.
- [ ] Chat Completions behavior is unchanged.
- [ ] Every failed/cancelled attempt destroys opaque continuation.

### Task 29: Add safe Responses capability probing and resolution

**Description:** Extend capability resolution with a harmless Responses probe that verifies endpoint support, requested reasoning controls, encrypted continuation, and a synthetic function-call round trip. The probe must not access vault, index, active note, or web tools.

**Acceptance criteria:**

- [ ] Manual override remains authoritative; otherwise a successful probe is required before automatic Responses/reasoning activation.
- [ ] Probe results are cached with provenance/freshness and invalidated by base URL, auth identity, model, or protocol changes.
- [ ] Probe failures distinguish endpoint, auth, model, effort, summary, tools, and continuation failures without storing response content.
- [ ] Unsupported or ambiguous profiles fail closed to their configured compatibility path or deterministic research fallback.

**Verification:**

- [ ] Tests cover success, each partial capability, stale cache, manual override, timeout, cancellation, and malicious compatible endpoints.
- [ ] Probe fixtures assert that no real application tool handler runs.

**Dependencies:** Tasks 23, 25, and 26.

**Files likely touched:** `src/client/chat/ChatModelCapabilityProbe.ts`, `src/client/chat/ChatModelCapabilities.ts`, `src/settings/settings.ts`, related tests.

**Estimated scope:** Large.

### Task 30: Add profile UI, safe summary events, and reasoning diagnostics

**Description:** Expose protocol, reasoning enablement, verified/manual effort values, and summary mode in model settings. Add ephemeral provider-summary status events and bounded diagnostics without exposing raw or encrypted reasoning.

**Acceptance criteria:**

- [ ] UI explains that Responses is opt-in, effort support is model-specific, and summaries are provider-generated rather than raw chain-of-thought.
- [ ] Unsupported controls are disabled with capability provenance and a precise reason.
- [ ] Diagnostics include protocol, capability source, configured effort, summary requested/available, reasoning item count, continuation rounds, and provider usage counts only.
- [ ] Summary events are visually separate from assistant content and are not persisted or exported in iteration 4.

**Verification:**

- [ ] UI/settings tests cover migration, protocol switching, override, unsupported effort, summary off/auto, and forced eager combinations.
- [ ] Snapshot/redaction tests search transcript, exports, notes, logs, diagnostics, and settings for sentinel raw/encrypted reasoning values.

**Dependencies:** Tasks 23 and 29.

**Files likely touched:** `src/settings/SettingsTab.ts`, `src/ui/ChatView.ts`, `src/ui/diagnosticFormatting.ts`, `src/shared/types.ts`, related tests.

**Estimated scope:** Large.

### Task 31: Activate Responses routing and complete end-to-end verification

**Description:** Route only eligible Responses profiles through the new adapter, retain Chat Completions as the migrated default, and verify the complete reasoning/tool/fallback matrix before enabling the feature.

**Acceptance criteria:**

- [ ] Eligible reasoning profiles complete text-only, mandatory-tool, repair, optional-tool, note/skill, eager, and fallback flows through Responses.
- [ ] Ineligible or failed profiles never silently lose tool choice or continuation; diagnostics identify the exact compatibility/fallback decision.
- [ ] Aborts, stream failures, incomplete responses, context limits, and plugin reloads leave no reusable continuation or partial answer.
- [ ] Saved conversations and answer notes remain schema-compatible.

**Verification:**

- [ ] End-to-end fake-provider suites cover agentic/eager × reasoning on/off × summary on/off × forced eager on/off.
- [ ] `npm test`, `npm run lint`, `npm run build`, and `npm run format` pass.

**Dependencies:** Tasks 27–30.

**Files likely touched:** `src/client/chat/ChatModelClient.ts`, `src/research/ResearchService.ts`, `src/main.ts`, integration tests.

**Estimated scope:** Large.

### Checkpoint: Reasoning support

- [ ] Tool rounds preserve ordered Responses continuation with `store: false` and no server-side conversation dependency.
- [ ] Raw/encrypted reasoning never enters user content, storage, exports, logs, or diagnostics.
- [ ] Forced eager remains an immediate research-strategy override without disabling reasoning synthesis.
- [ ] Existing Chat Completions, Anthropic, and Ollama behavior remains compatible.
- [ ] Capability probes and manual overrides fail closed and expose provenance.
- [ ] Saved conversations remain backward compatible.
- [ ] Full test suite, type check, build, format, and security/redaction review pass.
- [ ] Human review approves additional-provider work in iteration 5.

## Iteration 5: Additional providers and deep research

- Specify and implement Anthropic reasoning signatures/continuation.
- Specify and implement Ollama reasoning behavior only where the server exposes a stable contract.
- Define agentic `deepResearch` limits, source policy, and termination separately.

## Risks and mitigations

| Risk                                             | Impact | Mitigation                                                                                                             |
| ------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| New contracts accidentally alter current answers | High   | Iteration 1 keeps the existing eager implementation for both setting values and adds payload/evidence regression tests |
| Description is stale or misleading               | High   | Bind it to index timestamps/counts, regenerate only after commit, expose freshness, retain deterministic fallback      |
| Description generation adds indexing cost        | Medium | Local bounded representative sampling, deterministic topic extraction, and no regeneration for no-change runs          |
| Provider advertises tools but ignores choice     | High   | Capability validation, one repair, then clean fallback                                                                 |
| Reasoning state is flattened into text           | High   | Opaque continuation and ordered output items; storage exclusion tests                                                  |
| Tool loop increases latency/cost                 | Medium | Parallel first calls, strict budgets, cache duplicates, forced eager override                                          |
| Web/vault prompt injection                       | High   | Treat results as untrusted evidence and validate all citations                                                         |
| Web result enables SSRF on page fetch            | High   | Answer-scoped opaque handles, URL/redirect policy, private-address rejection, and fail-closed provider boundary        |
| Partial agentic run duplicates work on fallback  | Medium | Explicit diagnostics and clean, non-mixed fallback state                                                               |

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
- Server-side Responses continuation through `previous_response_id`; iteration 4 uses answer-scoped stateless continuation.
- Persistence of provider-generated reasoning summaries; iteration 4 keeps them ephemeral.
