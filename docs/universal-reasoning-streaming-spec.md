# Spec: Universal reasoning response streaming

## Status

Accepted on 2026-06-21. This document defines the approved target behavior and architecture. All recommendations in "Open questions and recommendations" are accepted as normative decisions unless superseded by a later ADR.

## Accepted decisions

1. A deep-reasoning answer may contain repeated `reasoning -> intermediate answer` stages before its final answer.
2. Intermediate answers remain visible while the loop is running.
3. After finalization, reasoning and intermediate answers are grouped into one collapsed `Research progress` disclosure belonging to the same assistant turn.
4. The final answer remains outside that disclosure as the primary assistant content.
5. All nineteen recommendations in this specification are accepted with their documented defaults and constraints.

## Relationship to the existing tool-loop specification

This specification is narrower in orchestration scope but newer and authoritative for response streaming, reasoning display, protocol neutrality, capability discovery, and reasoning persistence.

It supersedes the following statements in `docs/reasoning-tool-loop-spec.md`:

- assumption 4, which limits reasoning summaries to ephemeral UI state and forbids persistence;
- assumption 6, which defers provider-specific reasoning controls and UI;
- assumption 7, which makes Responses authoritative and Chat Completions only a compatibility protocol;
- any iteration requirement that gates reasoning display on Responses continuation capability.

The existing tool-loop requirements for application-enforced source policy, tool execution, evidence ownership, citations, and deterministic fallback remain authoritative.

## Objective

Display reasoning exposed by reasoning-capable models as a separate, live, collapsible block in the existing chat UI while remaining compatible with arbitrary OpenAI-compatible providers.

The implementation must:

- preserve the current visual style of the chat;
- support both Chat Completions and Responses streaming;
- tolerate common provider extensions without provider-name checks in the core stream pipeline;
- keep final answer text, visible reasoning, opaque continuation state, tool calls, and diagnostics separate;
- remove profile re-save as the mechanism for refreshing model capabilities;
- degrade to an ordinary streamed answer when no visible reasoning is available.

## User outcomes

1. When a provider streams visible reasoning, the user sees it appear before the final answer in one collapsible block.
2. While reasoning is active, the block is open by default and shows an active label such as `Thinking…`.
3. When reasoning ends, the block shows elapsed time, for example `Thought for 30.55 seconds`.
4. The final answer streams normally and remains visually consistent with existing assistant messages.
5. The user can manually expand or collapse the reasoning block, and later stream updates do not override that explicit choice.
6. Models without visible reasoning continue to behave exactly as they do today.
7. Capability state refreshes without editing and re-saving the profile.
8. A deep-reasoning loop can expose ordered intermediate answers without presenting them as final assistant messages.
9. When the loop completes, all reasoning and intermediate stages collapse into one `Research progress` block before the final answer.

## Assumptions

1. “OpenAI-compatible” describes a family of similar APIs, not a single complete reasoning standard.
2. Chat Completions and Responses are both supported protocols; neither is globally mandatory.
3. The application displays only reasoning content deliberately returned by the provider. It does not attempt to reveal hidden or encrypted chain-of-thought.
4. Provider metadata can improve configuration but is not required for parsing or displaying a stream.
5. A provider may expose visible reasoning through structured fields, semantic events, or inline tags.
6. The existing research and tool-loop behavior remains in scope and must preserve same-answer reasoning continuation when required by the upstream protocol.
7. No new runtime dependency is required for stream parsing or UI state management.

## Non-goals

- Guaranteeing that every reasoning model reveals its internal reasoning.
- Decrypting, transforming, or rendering encrypted reasoning payloads.
- Maintaining a hardcoded model-name catalog.
- Making LM Studio a required server or transport.
- Replacing the existing chat layout, colors, typography, or message header.
- Sending visible reasoning back in ordinary cross-turn chat history by default.
- Converting all provider APIs into one outbound request dialect.
- Automatically issuing paid generation requests solely to discover capabilities.

## Terminology

- **Visible reasoning**: text or summary the provider explicitly makes available for display.
- **Opaque reasoning state**: encrypted, signed, or provider-specific data required for same-answer continuation but not suitable for display.
- **Reasoning segment**: one ordered reasoning unit within an assistant response or tool round.
- **Stream dialect**: the upstream event/field format used by a compatible endpoint.
- **Request capability**: whether a provider accepts a specific outbound control such as `reasoning.effort`.
- **Response capability**: what the provider actually emits in its response stream.
- **Capability hint**: cached or metadata-derived information that may guide request construction but does not gate tolerant response parsing.

## Architecture

### Core rule

The core pipeline must dispatch on validated event shapes, never on provider names:

```text
HTTP/SSE or JSONL bytes
  -> protocol frame parser
  -> dialect-tolerant stream adapter
  -> provider-neutral ModelStreamEvent
  -> serialized AgentRun
  -> ResearchProgressProjector
  -> assistant message state
  -> reasoning block + final answer renderer
```

Provider-specific metadata resolvers may exist outside this pipeline. They return optional hints and cannot disable parsing of a field that is actually present in a response.

### Generic run and research projection

The execution runtime and research UX are separate layers. This adopts the useful boundary from OpenClaw's agent loop without coupling the plugin to OpenClaw or any provider:

- `AgentRun` serializes one active run per chat and owns `runId`, cancellation, rounds, model calls, tools, deadlines, budgets, and terminal status.
- It emits generic lifecycle, reasoning, assistant-text, tool, usage, and completion events. It does not know about disclosures or provisional research checkpoints.
- `ResearchProgressProjector` classifies buffered round text as an intermediate checkpoint or final answer.
- Provider adapters only normalize request and response dialects. Provider names must not appear in `AgentRun` or the projector.
- UI delivery may coalesce frequent deltas, but coalescing must not change persisted event order or parser semantics.

Run invariants:

- Starting a replacement run first cancels and settles the previous run.
- Every event carries `runId`; reducers ignore stale events from cancelled or replaced runs.
- Tool outputs are size-bounded and normalized before entering model context, persistence, diagnostics, or rendering.
- Tool calls and matching results remain atomic pairs during context compaction.
- Budgets are checked after every model round and tool result.
- Skills and tool policy are snapshotted at run start; changes apply to the next run.
- Final reply shaping deduplicates streamed and terminal text and suppresses empty internal payloads.

### Provider-neutral stream contract

```ts
export type ModelStreamEvent =
  | { type: "reasoning-start"; segmentId: string; visibility: "text" | "summary" }
  | { type: "reasoning-delta"; segmentId: string; text: string }
  | { type: "reasoning-end"; segmentId: string }
  | { type: "text-delta"; text: string }
  | { type: "tool-call-delta"; index: number; id?: string; name?: string; argumentsText?: string }
  | { type: "usage"; inputTokens: number; outputTokens: number; reasoningTokens: number }
  | { type: "complete"; stopReason: "complete" | "tool_calls" | "length" | "error" };
```

Contract requirements:

- Event order must match upstream order.
- Empty deltas are ignored.
- Reasoning segment IDs must remain stable for the lifetime of one assistant response.
- Adapters synthesize `reasoning-start` before the first reasoning delta when the upstream format has no explicit start event.
- Adapters synthesize `reasoning-end` before the first final-text delta, tool-call boundary, or completion when the upstream format has no explicit end event.
- Consumers must tolerate multiple reasoning segments and interleaving with tool calls.
- Malformed external data is rejected or ignored at the adapter boundary; internal consumers receive validated events.

### Deep-reasoning loop contract

Transport adapters do not decide whether streamed text is intermediate or final. They emit `text-delta`; the orchestration layer classifies the completed model round after its stop reason and tool calls are known.

```ts
export type ReasoningLoopEvent =
  | { type: "reasoning"; round: number; segmentId: string; delta: string }
  | { type: "tool-call"; round: number; call: ChatToolCall }
  | { type: "tool-result"; round: number; callId: string; output: string }
  | { type: "intermediate-start"; round: number; checkpointId: string }
  | { type: "intermediate-delta"; round: number; checkpointId: string; delta: string }
  | { type: "intermediate-end"; round: number; checkpointId: string }
  | { type: "final-delta"; delta: string }
  | { type: "complete" };
```

Classification rules:

- Text produced by a round that also requests tools or explicitly requests continuation becomes an intermediate answer.
- Text produced by a successful terminal round with no pending tools becomes the final answer.
- A fallback or repair round may supersede an intermediate answer but must not erase it from `Research progress`.
- If the provider streams text before the application knows the round outcome, the UI holds that text in the active checkpoint buffer. It is committed as intermediate or final only when the round outcome is known.
- Intermediate answers are labelled provisional and must not be cited or copied as the final answer.
- The loop terminates on a successful terminal round or a configured guard: maximum rounds, tool calls, token budget, deadline, cancellation, repeated-call detection, or unrecoverable error.

### Separation of visible and opaque reasoning

```ts
export interface ReasoningSegment {
  id: string;
  kind: "text" | "summary";
  content: string;
}

export interface ProviderContinuationState {
  readonly provider: ApiFormat;
  dispose(): void;
}
```

- `ReasoningSegment` is safe to persist and render after Markdown sanitization through the existing Obsidian renderer.
- Encrypted/signature/provider payloads remain inside `ProviderContinuationState` or an equivalent answer-scoped object.
- Opaque state must not be serialized into normal saved chat messages.
- Opaque state must be disposed on completion, cancellation, failure, or fallback.

## Supported inbound stream dialects

### Chat Completions

The adapter must recognize the following fields under `choices[0].delta`:

1. `reasoning_details[]`
   - `reasoning.text.text` is visible reasoning text.
   - `reasoning.summary.summary` is a visible summary.
   - encrypted or unknown blocks are retained only as opaque continuation data when required.
2. `reasoning`
3. `reasoning_content`
4. `thinking`
5. configured inline tags inside `content`

When more than one visible representation is present in the same chunk, use the first non-empty source in the priority order above. Do not concatenate duplicate aliases.

The default inline tag pairs are:

- `<think>` / `</think>`
- `<thinking>` / `</thinking>`
- `<reasoning>` / `</reasoning>`
- `<thought>` / `</thought>`
- `<|begin_of_thought|>` / `<|end_of_thought|>`

Inline parsing must use an incremental state machine. Opening and closing tags may be split across arbitrary byte, SSE, and content-delta boundaries. Tag text must not appear in either the reasoning block or final answer.

### Responses

The adapter must support at least:

- `response.reasoning_text.delta`;
- `response.reasoning_summary_text.delta`;
- `response.reasoning.delta` as a compatible extension;
- `response.output_text.delta`;
- `response.function_call_arguments.delta` and terminal function-call items;
- `response.completed`, `response.incomplete`, `response.failed`, and top-level `error`.

Terminal parsing must recover visible reasoning from both `reasoning.summary[]` and `reasoning.content[]` when the provider returns them only in the terminal response.

The client must not assume every compatible provider emits `[DONE]` after a terminal Responses event.

### Non-reasoning streams

If no reasoning representation is observed, adapters emit only text/tool/completion events. No empty reasoning block is created.

## Outbound request policy

Parsing and outbound reasoning control are independent.

### Reasoning mode

- `off`: do not request reasoning. The parser remains tolerant if a provider ignores the setting and still returns visible reasoning.
- `auto`: omit provider-specific reasoning controls and accept the provider/model default.
- `on`: send a reasoning control only when its request dialect is known from metadata, a previous successful request, or an explicit advanced override.

### Conservative writer, tolerant reader

- Unknown response extensions are ignored safely.
- Known response extensions are parsed regardless of cached capabilities.
- Unknown outbound request fields are not sent optimistically.
- If an HTTP error conclusively identifies an unsupported optional reasoning control and no response body has begun streaming, the application may retry once without that optional control.
- It must never retry after emitting any visible text, reasoning, or tool event.
- Protocol fallback must be recorded in diagnostics.

### Protocol selection

`auto` protocol selection uses server capability hints:

1. Use a protocol explicitly selected by the user.
2. Otherwise use a previously successful protocol for the same endpoint and model.
3. Otherwise prefer Chat Completions as the compatibility baseline.
4. Responses may be selected when metadata or a prior request confirms support.

Visible reasoning does not require Responses. A failed Responses check must not disable reasoning parsing on Chat Completions.

## Capability discovery and refresh

### Capability model

Capabilities are split by concern:

```ts
interface ModelCapabilitySnapshot {
  protocols: {
    chatCompletions: CapabilityState;
    responses: CapabilityState;
  };
  reasoning: {
    responseFormats: Array<
      | "reasoning_details"
      | "reasoning"
      | "reasoning_content"
      | "thinking"
      | "inline_tags"
      | "responses_text"
      | "responses_summary"
    >;
    requestDialect?: "responses" | "openrouter" | "provider-extension";
    efforts?: string[];
    defaultEffort?: string;
    visibleOutput: CapabilityState;
  };
  tools: CapabilityState;
  continuation: CapabilityState;
  summary: CapabilityState;
  source: "metadata" | "observed" | "manual" | "probe";
  checkedAt: string;
  contractVersion: number;
}

type CapabilityState = "supported" | "unsupported" | "unknown";
```

No aggregate `reasoningSupported` boolean may be used to gate the entire feature.

### Discovery sources

Sources are applied in this order:

1. Explicit advanced user override.
2. Successful passive observation from real requests.
3. Optional provider metadata resolver.
4. Explicit manual probe.
5. Unknown.

LM Studio, OpenRouter, or other metadata endpoints may be implemented as optional resolvers. The OpenAI-compatible core must work when none match.

### Passive observation

Every successful real request may update capability hints:

- observed event shapes update response formats;
- a successful outbound reasoning control updates its request dialect/effort hint;
- successful tool continuation updates continuation support;
- observations are keyed by normalized endpoint, model, protocol, and contract version.

Observation must never mutate the profile object currently being edited. It updates a separate capability cache and persists through the settings service.

### Refresh lifecycle

Capability refresh is triggered by:

- plugin startup for active profiles, subject to cache freshness;
- opening model settings;
- changing endpoint or model selection;
- clicking `Refresh capabilities`;
- cache contract-version changes.

Saving a profile may schedule refresh but is not required to initiate it.

### Probe policy

- Automatic refresh performs metadata and cache reconciliation only; it does not issue generation requests.
- A generation probe is explicit and user-initiated.
- Each capability is probed independently.
- A reasoning visibility probe must not require tools, forced tool choice, continuation, summary, or a specific effort.
- Tool continuation is probed only when tools are enabled and the user explicitly requests it.
- Positive and negative results are cached with separate TTLs.
- Cancellation and stale-result suppression are required when endpoint/model changes during a probe.

## Assistant message state

```ts
interface AssistantReasoningState {
  phase: "idle" | "streaming" | "complete" | "interrupted";
  disclosure: "auto" | "user-open" | "user-closed";
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  segments: ReasoningSegment[];
}

interface ResearchProgressCheckpoint {
  id: string;
  round: number;
  content: string;
  status: "streaming" | "complete" | "superseded" | "interrupted";
}

interface AssistantResearchProgress {
  phase: "idle" | "streaming" | "complete" | "interrupted";
  disclosure: "auto" | "user-open" | "user-closed";
  reasoning: AssistantReasoningState;
  checkpoints: ResearchProgressCheckpoint[];
}
```

Rules:

- The first reasoning event creates the assistant message if necessary.
- `disclosure: auto` is open while reasoning is streaming and closed when final text begins or the response completes.
- User interaction changes disclosure to `user-open` or `user-closed`; subsequent deltas preserve it.
- All segments are presented inside one visual reasoning disclosure per assistant response.
- Tool rounds may create multiple internal segments but must not create multiple adjacent disclosure widgets.
- Intermediate answers are appended as ordered checkpoints inside the same disclosure.
- During execution, the disclosure is open in `auto` mode so the active reasoning/checkpoint is visible.
- After a final answer completes, `auto` mode collapses the disclosure and changes its label to `Research progress`.
- Cancellation/failure closes the active segment as `interrupted` without discarding already displayed reasoning.
- Duration uses a monotonic clock during the live request and stores the final millisecond value for reload.

## UI behavior

The existing assistant message header and answer styling remain unchanged.

The research-progress block:

- is rendered before `.ixplorer-chat__answer-content`;
- uses a native `<details>`/`<summary>` control;
- uses existing Obsidian color, border, spacing, and typography variables;
- shows `Thinking…` or the active checkpoint while the loop is running;
- shows `Research progress · <round count> rounds · <duration>` after completion;
- exposes one keyboard-focusable summary control;
- contains all ordered visible reasoning segments and intermediate answers;
- clearly labels intermediate answers as provisional checkpoints;
- is absent when reasoning and intermediate checkpoints are both empty;
- is excluded from the normal `Copy message` action;
- is rendered with the existing Markdown renderer and normal output sanitization.

Streaming updates should patch the active assistant message instead of clearing and re-rendering the complete transcript for every token. Markdown rendering may be throttled during active reasoning and finalized when the segment ends.

## Persistence and prompt history

- Visible reasoning, intermediate checkpoints, and final `durationMs` are persisted separately from assistant `content`.
- User disclosure preference may be persisted for reopened chats.
- Normal copy, note export, title generation, query expansion, compaction, and cross-turn prompt history exclude visible reasoning and intermediate checkpoints by default.
- Same-answer tool continuation may reuse opaque or structured reasoning exactly as required by the selected protocol.
- Provider-specific signed/encrypted blocks must be passed back unmodified and in order when continuation requires them.
- A schema migration must preserve older chats without reasoning fields.
- The saved chat message remains the initial canonical persisted representation. A full append-only execution journal is deferred until crash recovery or replay is a demonstrated requirement.
- Context pruning may trim old tool outputs from the next model request while retaining persisted research progress and final answers.
- Compaction must never separate a tool call from its result and must preserve opaque protocol identifiers exactly.

## Error handling and diagnostics

Diagnostics should include:

- selected protocol and selection source;
- observed response dialects;
- requested reasoning mode and effort;
- whether a retry removed an unsupported optional control;
- whether protocol fallback occurred;
- visible reasoning segment count;
- reasoning duration and token count when available;
- capability source and freshness;
- terminal stop reason;
- parser warnings without including full private response bodies.

Malformed reasoning extensions must not corrupt final answer text. A malformed optional reasoning field is ignored with a diagnostic warning unless it prevents unambiguous framing of the entire response.

The per-answer diagnostic modal follows `docs/diagnostic-report-popover.md`. New run/stream/projection diagnostics must be available in both its readable view and canonical raw view. The modal can export the readable view as deterministic, self-contained, redacted HTML without scripts or remote resources.

## Security and privacy

- External response data is untrusted and validated at the adapter boundary.
- Visible reasoning is rendered through the existing safe Markdown path.
- Provider errors and diagnostics must not log API keys, full prompts, full reasoning, encrypted blocks, or raw response bodies by default.
- Capability cache identity must not persist raw credentials.
- Opaque continuation state is answer-scoped, bounded, and disposed deterministically.
- Reasoning content is not treated as instructions for the application or tool runner.

## Tech stack

- TypeScript 5.4 strict mode.
- Obsidian 1.5 APIs and `MarkdownRenderer`.
- Native `fetch`, `ReadableStream`, SSE/JSONL parsers.
- Vitest 1.6.
- No additional production dependency planned.

## Commands

```bash
npm test
npx tsc --noEmit
npm run build
npm run format
```

`npm run build` writes the production bundle to the configured Obsidian plugin directory. In restricted environments, `npx tsc --noEmit` and a workspace-local esbuild target must be used separately.

## Project structure

```text
src/client/common/                 HTTP and stream framing
src/client/chat/                   Chat Completions and Responses adapters
src/shared/types.ts                Provider-neutral stream contracts
src/research/                      Event propagation and tool loops
src/settings/                      Capability cache, discovery, refresh UI
src/ui/rendering.ts                Persistent assistant reasoning state helpers
src/ui/ChatTranscript.ts           Reasoning disclosure and answer rendering
tests/unit/                        Parser, propagation, settings, persistence tests
docs/                              Specification and implementation plan
```

## Code style

Use discriminated unions and exhaustive event handling:

```ts
function applyStreamEvent(state: AssistantState, event: ModelStreamEvent): AssistantState {
  switch (event.type) {
    case "reasoning-delta":
      return appendReasoning(state, event.segmentId, event.text);
    case "text-delta":
      return appendAnswer(state, event.text);
    case "reasoning-start":
    case "reasoning-end":
    case "tool-call-delta":
    case "usage":
    case "complete":
      return applyNonTextEvent(state, event);
  }
}
```

Conventions:

- External JSON is parsed from `unknown` and validated once at the boundary.
- Provider field names remain inside adapters.
- Core types use provider-neutral names.
- Empty optional arrays/objects are omitted from persisted settings.
- New behavior is additive until migration is complete.

## Testing strategy

### Parser contract tests

Fixtures must cover formats, not provider brands:

- `delta.reasoning_content`;
- `delta.reasoning`;
- `delta.thinking`;
- `delta.reasoning_details` text, summary, encrypted, and duplicated aliases;
- inline tags split at every possible character boundary;
- standard and extension Responses reasoning events;
- terminal-only reasoning content and summaries;
- reasoning followed by text in the same chunk;
- reasoning/tool/text interleaving;
- malformed optional fields;
- ordinary non-reasoning streams.

### State and UI tests

- One disclosure per assistant response.
- Repeated reasoning/intermediate stages preserve order inside that disclosure.
- Auto-open, auto-close, user-open, and user-closed transitions.
- Duration finalization for complete, cancelled, and failed streams.
- Reasoning excluded from normal copy and prompt history.
- Intermediate checkpoints excluded from final-answer copy and normal cross-turn history.
- Saved chat round-trip and migration.
- No full transcript replacement for a single active delta.

### Integration tests

- Chat Completions stream -> normalized events -> saved message.
- Responses stream -> normalized events -> saved message.
- Tool continuation preserves required opaque reasoning state.
- Failed optional request control retries at most once before stream output.
- Capability refresh works without profile save.

### Manual verification

Test at least:

1. One OpenAI-compatible provider returning `reasoning_content`.
2. One provider returning `reasoning` or `reasoning_details`.
3. One Responses-compatible endpoint.
4. One model returning inline reasoning tags.
5. One ordinary model with no reasoning.

For each, verify live rendering, final collapse behavior, copy behavior, reload persistence, cancellation, regeneration, and tool use where supported.

## Boundaries

### Always

- Preserve provider event order.
- Validate external response shapes.
- Keep visible and opaque reasoning separate.
- Run targeted tests, full tests, and type checking.
- Record fallback and parser warnings in redacted diagnostics.

### Ask first

- Adding a production dependency.
- Changing saved-chat schema beyond additive migration.
- Automatically issuing generation probes.
- Sending visible reasoning in normal cross-turn history.
- Enabling provider-specific outbound controls by default.
- Changing existing chat styling beyond reasoning-block selectors.

### Never

- Gate response parsing on a provider brand or model-name regex.
- Log or persist raw encrypted reasoning.
- Retry after any visible stream output has been emitted.
- Mix reasoning text into final assistant `content`.
- Treat a failed optional probe as proof that the model cannot reason.
- Expose an empty reasoning disclosure.

## Success criteria

1. The format-based parser matrix passes for Chat Completions and Responses.
2. Existing non-reasoning and tool-call tests remain behaviorally compatible.
3. Visible reasoning streams into one separate disclosure before the answer.
4. Manual collapse/expand state survives later deltas.
5. Reasoning duration is displayed and survives chat reload.
6. The normal copy action and prompt history contain only the final answer.
7. No provider name is referenced by the core stream normalization or UI code.
8. A profile receives refreshed capability state without being edited or re-saved.
9. Automatic refresh performs no generation request.
10. A failed Responses capability does not disable Chat Completions reasoning display.
11. All unit tests and `npx tsc --noEmit` pass.
12. Manual checks pass across the five format categories listed above.
13. A loop with at least two reasoning/intermediate stages renders live and collapses into one `Research progress` block after the final answer.
14. Replaced or cancelled runs cannot update the current message through late events.
15. Context pruning preserves tool-call/result pairs and exact continuation identifiers.

## Resolved questions and accepted recommendations

All entries in this section are resolved. The word "Recommendation" records the accepted choice rather than an unresolved proposal.

### 1. Should visible reasoning be persisted?

**Recommendation:** Yes, persist provider-exposed text/summary separately from the answer, but exclude it from normal copy, exports, compaction, title generation, and prompt history by default. This matches the target UI after chat reload without contaminating future prompts.

### 2. Should all reasoning segments appear as separate disclosures?

**Decision accepted:** No. Render one `Research progress` disclosure per assistant response. Keep reasoning and intermediate-answer stages internally ordered, visible while running, and collapsed together after the final answer.

### 3. When should the reasoning block close automatically?

**Recommendation:** Close when the first final-text delta arrives. If the user already changed the disclosure manually, preserve the user choice.

### 4. What should `auto` reasoning mode send upstream?

**Recommendation:** Send no optional reasoning control. Accept provider/model defaults and parse whatever is returned. This is the safest universal behavior.

### 5. What should `on` do when the request dialect is unknown?

**Recommendation:** Do not guess silently. Show an advanced configuration warning and either use a user-selected request dialect or run an explicit probe. Parsing remains active regardless.

### 6. Should the application automatically fall back between Responses and Chat Completions?

**Recommendation:** Permit one fallback only for a conclusive unsupported endpoint/parameter error received before any stream event. Never fall back after output begins. Persist the successful protocol hint.

### 7. Should generation probes run automatically?

**Recommendation:** No. Automatic refresh should use cache and metadata only. Generation probes have latency, privacy, model-loading, and billing effects and should be user-initiated.

### 8. Are provider-specific metadata resolvers allowed?

**Recommendation:** Yes, as optional plugins behind a common resolver interface. Their output is a hint with provenance and freshness; they cannot introduce provider checks into parsers, orchestration, or UI.

### 9. Which inline reasoning tags should be enabled by default?

**Recommendation:** Use the five documented pairs in this specification and allow a per-profile custom pair. Do not infer arbitrary XML tags because that risks moving legitimate answer content into reasoning.

### 10. Should visible reasoning be sent back during tool continuation?

**Recommendation:** Only when the upstream protocol explicitly requires that exact structured block. Prefer opaque/signed provider state where available. Do not resend display Markdown as generic assistant content.

### 11. How should duplicate reasoning aliases be handled?

**Recommendation:** Select one source per chunk using the documented precedence. Add diagnostics when multiple non-empty representations differ; do not display both.

### 12. Should duration use provider timing or client timing?

**Recommendation:** Use monotonic client timing for consistent live behavior. Prefer provider timing only if a future normalized timing contract proves equivalent and complete.

### 13. Should capability failures disable UI controls?

**Recommendation:** No. Show `unknown`, `observed`, or `unsupported` status with provenance. Disable only outbound controls conclusively unsupported by a fresh result; never disable tolerant response parsing.

### 14. Is LM Studio's native `/api/v1/chat` endpoint part of the first implementation?

**Recommendation:** No. First complete universal Chat Completions and Responses support. A native LM Studio adapter can be added later without changing the normalized contract or UI.

### 15. Should reasoning labels be localized now?

**Recommendation:** Keep the existing English UI convention for this change (`Thinking…`, `Thought for …`). Introduce localization only as a separate application-wide concern.

### 16. How should the conflict with the existing tool-loop specification be resolved?

**Recommendation:** Approve this document as the authoritative contract for streaming, display, persistence, and capability discovery, then amend the conflicting assumptions in the older specification before implementation begins. Do not leave two active specifications with incompatible protocol and persistence rules.

### 17. Should the application persist a complete append-only run event log?

**Recommendation:** Not in the first release. Keep saved chat messages canonical and add an answer-scoped diagnostic journal only in memory. Introduce a durable event log later if crash recovery, replay, or branchable sessions become explicit requirements.

### 18. May skills or tool definitions refresh during an active run?

**Recommendation:** No. Snapshot them at run start and expose the snapshot version in diagnostics. Refresh for the next run so identical events cannot acquire different meanings midway through execution.

### 19. How should provider failover behave inside a deep run?

**Recommendation:** Allow protocol fallback only before output begins. Cross-model/provider failover after reasoning or tool execution should start a clearly identified recovery run with reconstructed portable context; never pass opaque continuation state to a different provider.

## OpenClaw references

The reusable patterns above were checked against OpenClaw's official documentation:

- [Agent loop](https://docs.openclaw.ai/concepts/agent-loop)
- [Streaming and progress previews](https://docs.openclaw.ai/concepts/streaming)
- [Model-provider plugins](https://docs.openclaw.ai/concepts/model-providers)
- [Thinking and reasoning controls](https://docs.openclaw.ai/tools/thinking)
- [Skills](https://docs.openclaw.ai/tools/skills)
- [Compaction](https://docs.openclaw.ai/compaction)
- [Session management and compaction](https://docs.openclaw.ai/reference/session-management-compaction)
- [Session pruning](https://docs.openclaw.ai/concepts/session-pruning)
