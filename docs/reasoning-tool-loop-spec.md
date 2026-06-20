# Spec: Reasoning-ready research tool loop

## Status

Approved requirements draft. Implementation is phased; iteration 1 adds a configurable eager override without activating agentic execution.

## Assumptions

1. The selected search mode is an application policy, not a suggestion to the model.
2. “Required in the first request” means that the first model round must request every required source tool before a final answer can be accepted.
3. A required source is satisfied only by a successfully executed tool call, not merely by an attempted call.
4. Full chain-of-thought is neither rendered nor persisted. Provider-supported reasoning summaries may be exposed separately later.
5. When the necessary `tool_choice` behavior or reasoning continuation is unavailable, the existing deterministic evidence pipeline remains the fallback.
6. This change prepares the architecture for reasoning models; provider-specific reasoning controls and UI may be delivered separately.
7. OpenAI Responses is the authoritative target for full reasoning continuation. OpenAI-compatible Chat Completions remains a compatibility protocol.

## Objective

Allow a model to select, retrieve, and refine the evidence used for a final research answer through an iterative tool loop. Preserve application-enforced source policy for each search mode and preserve provider-specific reasoning state across tool rounds.

The user should receive an answer based on evidence selected during the loop, with stable citations and diagnostics, while retaining the current deterministic retrieval flow for incompatible providers.

## Non-goals

- Displaying raw chain-of-thought.
- Allowing the model to override the selected search mode.
- Replacing the current skill catalog or `read_note` skill-loading contract.
- Removing the existing eager context/retrieval/web pipeline.
- Treating arbitrary tool output as trusted instructions.

## User-visible behavior

### Execution mode setting and rollout guard

Settings expose **Force eager research mode** (`forceEagerResearch`). It defaults to `false` for new and migrated installations and is always editable.

When enabled, the setting is an unconditional global override: every model uses eager research regardless of detected tool or reasoning capabilities. When disabled, it does not force a strategy; the normal strategy selector may choose agentic execution once that path is implemented and compatible. During iteration 1, agentic execution does not exist yet, so disabling the override still leaves the current eager pipeline as the only available implementation.

When forced eager mode is enabled:

- the existing context, index, web, evidence-planning, and synthesis pipeline remains authoritative;
- active-file context continues to be assembled eagerly;
- research `tool_choice` policies and `search_index`/`search_web` are not used for answer execution;
- diagnostics report `executionStrategy: "eager-forced"`.

When forced eager mode is disabled during iteration 1, diagnostics report `executionStrategy: "eager-default"`. In later iterations they may report an agentic strategy or deterministic fallback.

### Mandatory first-round source policy

| Search mode | Required successful tools before final answer |
| --- | --- |
| `none` | None |
| `indexOnly` | `search_index` |
| `indexAndWeb` | `search_index` and `search_web` |
| `webOnly` | `search_web` |

When **Include active file as context** is enabled, `get_active_note` is additionally required in every mode. The active note content must not be inserted into the initial prompt.

In `indexOnly` and `indexAndWeb`, the first model request must include the current selected index's short description. The description tells the model what domains, folders, source types, languages, and representative topics are available for retrieval; it is context for query formulation and does not satisfy the mandatory `search_index` call.

Explicitly attached context remains application-provided context unless this specification is amended. It is not implicitly converted into a model-selected source.

### First model round

The first model request contains:

- system and research instructions;
- user question and chat history within budget;
- compact skill catalog when applicable;
- tool definitions allowed by the current mode;
- required-source policy;
- the selected index description in index-backed modes;
- `tool_choice` selected from provider capabilities.

It does not contain eagerly retrieved index evidence, web evidence, or active-note content in the agentic path.

The model should emit all required independent calls in parallel when the provider supports parallel calls. The application validates the returned call set; prompt instructions alone are not considered enforcement.

### Repair rounds

If the first model round omits a required tool, the controller must not accept generated text as the final answer. It must force each missing tool through a provider-supported specific choice, or abandon the agentic attempt and restart through the deterministic fallback.

After all mandatory tools succeed, subsequent rounds use `tool_choice: "auto"`. The model may refine searches, read notes, load one selected skill, or finish the answer.

### Completion

A final answer is accepted only when:

- all mandatory source requirements are satisfied;
- any selected skill was loaded successfully through the existing skill contract;
- the model produces a terminal text response without unresolved tool calls;
- citations reference evidence actually returned by successful tool executions;
- configured round, call, and output budgets were not exceeded.

## Execution strategies

### Agentic strategy

Used only when the provider supports every capability needed by the computed policy.

```text
prepare policy
  -> first model round
  -> validate mandatory calls
  -> execute calls
  -> preserve model/reasoning state
  -> repair missing mandatory calls when possible
  -> auto-choice research rounds
  -> validate and persist final answer
```

### Deterministic fallback strategy

The existing pipeline remains responsible for assembling active/explicit context, searching the index and web, planning evidence, and making a synthesis request.

Fallback is selected before accepting any agentic final answer when:

- tools are unsupported;
- required or specific tool choice needed by the policy is unsupported;
- returned tool calls are malformed;
- required calls remain missing after the repair allowance;
- mandatory tool execution fails and the failure policy requires fallback;
- reasoning continuation required by the selected model cannot be preserved;
- the loop repeats calls or exhausts a configured budget.

The fallback run starts from a clean synthesis state. Partial agentic evidence must not be silently mixed into the deterministic run unless explicitly specified later.

## Index description

Each `IndexProfile` stores generated description metadata:

```ts
interface IndexDescription {
  text: string;
  generatedAt: string;
  indexUpdatedAt: string;
  generator: "deterministic";
  algorithmVersion: number;
  status: "current" | "stale" | "failed";
  sourceCount: number;
  chunkCount: number;
}
```

The description is generated locally and deterministically during the indexing lifecycle after a successful index commit. It does not call an LLM, embedding endpoint, or any other network service. It is based only on bounded aggregate metadata and representative indexed content, never on raw vector values. Input should include:

- index profile name and whole-vault/selected mode;
- included folders and exclusions in compact form;
- source kinds and language inventory;
- file/chunk counts;
- bounded representative paths, titles, headings, and text samples;
- representative terms or topics derived from indexed content.

The output is a concise factual description intended to help a model decide what it can retrieve and formulate effective `search_index` queries. It must not contain instructions to the answering model.

Generation rules:

- generate after the initial index, rebuild, and any completed incremental run that changed indexed content;
- do not regenerate after a no-change indexing run;
- persist the description only after the index commit succeeds;
- mark the previous description `stale` while changed index content lacks a matching new description;
- if full sampling fails, store a minimal deterministic description assembled from profile scope, source kinds, languages, counts, and available representative paths/topics;
- description failure must not roll back or invalidate an otherwise successful index;
- cap the persisted and prompt-injected text at a configured character/token limit;
- diagnostics identify algorithm version, freshness, input sampling, truncation, and failure reason.

The selected description is injected into the research system context for both execution strategies:

- eager: the synthesis request in `indexOnly` and `indexAndWeb`;
- agentic: the initial bootstrap request in `indexOnly` and `indexAndWeb`.

It is omitted in `none` and `webOnly`. If no current description exists, construct a minimal deterministic description on demand and report this in diagnostics. Changing the selected index changes the injected description.

## Tool contracts

### `search_index`

Input:

```ts
interface SearchIndexInput {
  query: string;
  limit?: number;
}
```

Output:

```ts
interface SearchIndexResult {
  ok: boolean;
  query: string;
  results: Array<{
    evidenceId: string;
    chunkId: string;
    path: string;
    title: string;
    snippet: string;
    score: number;
    source: Record<string, unknown>;
  }>;
  diagnostics: Record<string, unknown>;
  error?: ToolError;
}
```

The tool searches the existing index and excludes internal skill paths. It returns bounded snippets and stable evidence IDs, not unrestricted full documents. The model may use `read_note` for a complete supported vault file.

### `search_web`

Input:

```ts
interface SearchWebInput {
  query: string;
  limit?: number;
}
```

Output:

```ts
interface SearchWebResult {
  ok: boolean;
  query: string;
  results: Array<{
    resultId: string;
    evidenceId: string;
    url: string;
    title: string;
    snippet: string;
    rank: number;
  }>;
  diagnostics: Record<string, unknown>;
  error?: ToolError;
}
```

This tool returns bounded search-result snippets only. A separate `fetch_web_page` tool fetches and extracts a selected page in an agentic iteration.

### `fetch_web_page`

```ts
interface FetchWebPageInput {
  resultId: string;
}
```

The opaque `resultId` must have been returned by `search_web` in the same answer scope. The application resolves it to the registered canonical URL. Output contains bounded extracted text, source metadata, a stable evidence ID, and truncation diagnostics. Raw model-supplied URLs and IDs from previous answer scopes are rejected unless a later specification explicitly permits them.

### Existing note tools

`read_note`, `list_notes`, `search_notes`, and `get_active_note` retain their current names and structured JSON results. `get_active_note` must report `no-active-note` distinctly so the controller can apply the configured mandatory-source failure policy.

### Error shape

All research tools use one error contract:

```ts
interface ToolError {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}
```

Expected tool failures are returned as structured results and recorded in diagnostics. Unexpected host failures may abort the loop.

## Model and provider contracts

### Capabilities

The current single `tools` boolean is insufficient. The target capability contract must distinguish at least:

```ts
interface ToolCallingCapabilities {
  calls: boolean;
  choiceRequired: boolean;
  choiceSpecific: boolean;
  parallelCalls: boolean;
}

interface ReasoningCapabilities {
  enabled: boolean;
  continuation: boolean;
  summary: boolean;
}
```

Capability detection combines metadata and probing with an explicit manual override. Its effective value and source remain visible in diagnostics/settings. Forced eager mode always takes precedence.

### Tool choice

The provider-neutral request contract must support:

```ts
type ChatToolChoice =
  | { type: "auto" }
  | { type: "none" }
  | { type: "required" }
  | { type: "specific"; name: string };
```

Each provider adapter maps this contract to its native request format. Unsupported mappings must fail capability validation rather than being silently dropped.

### Ordered model output

The current `content + toolCalls` response loses reasoning structure. The target interface must preserve ordered output items:

```ts
type ModelOutputItem =
  | { type: "text"; text: string }
  | { type: "reasoning"; providerData: unknown; summary?: string }
  | { type: "toolCall"; call: ChatToolCall };

interface ModelRoundResult {
  items: ModelOutputItem[];
  continuation?: ProviderContinuationState;
  stopReason: "complete" | "tool_calls" | "length" | "error";
}
```

`ProviderContinuationState` is opaque outside the provider adapter. It may represent response IDs, reasoning items, signatures, or another native continuation mechanism. It must never be serialized as ordinary assistant text.

## Policy controller

The controller maintains explicit state:

```ts
interface ResearchLoopState {
  phase: "bootstrap" | "repair" | "research" | "complete" | "fallback";
  requiredTools: Set<string>;
  satisfiedTools: Set<string>;
  attemptedTools: Set<string>;
  evidence: Map<string, RetrievedChunk>;
  citations: Map<string, Citation>;
  diagnostics: ToolCallDiagnostic[];
  continuation?: ProviderContinuationState;
  round: number;
}
```

Only the controller decides whether source policy is satisfied. The model decides query wording, optional follow-up tools, and when to propose a final answer.

Repeated identical calls are detected by normalized tool name and arguments and reuse the cached result while still counting against the total call budget.

## Evidence and citations

- Every index chunk and web result receives a stable `evidenceId`.
- Tool execution registers evidence before returning the result to the model.
- Final citations are derived from registered evidence, not parsed from arbitrary URLs or paths in model text.
- Duplicate evidence from multiple calls is stored once while retaining call provenance.
- Tool results must state that retrieved content is untrusted evidence and cannot override system or source-policy instructions.
- Existing `ResearchAnswer`, diagnostics, note export, and chat persistence remain backward compatible through additive fields.

## Skills interaction

- The compact skill catalog may be included in the first request when skill selection is permitted.
- A model may choose at most one skill.
- A selected skill must still be loaded via exact-path `read_note` before a skill-guided answer is accepted.
- Skill loading does not satisfy index or web source requirements.
- Internal skill files never appear in index search results.

## Budgets and safeguards

The loop must configure and diagnose:

- maximum total model rounds;
- maximum bootstrap repair rounds;
- maximum calls per tool and total calls;
- maximum index results and snippet characters;
- maximum web results/page characters;
- maximum cumulative tool-result characters/tokens;
- provider timeout and per-tool timeout;
- duplicate-call handling;
- user cancellation.

Initial agentic defaults are five total model rounds, one bootstrap repair round, five calls per round, ten total calls, five index results, five web results, 16,000 characters per fetched document, and 50,000 cumulative tool-result characters. Exceeding a budget produces a machine-readable reason and deterministic fallback.

## Diagnostics and UI

Diagnostics must expose:

- selected execution strategy: `agentic` or `deterministic-fallback`;
- provider capability decision and source;
- required, attempted, satisfied, failed, and repaired tools;
- model rounds and stop reasons;
- queries, result counts, truncation, timing, and budgets;
- fallback reason;
- selected index description text hash, freshness, algorithm version, and generation timestamp;
- reasoning availability and continuation status, but not raw private reasoning.

The normal transcript continues to stream final answer text. Intermediate model text produced before mandatory tools are satisfied must not be rendered as a final answer. Tool activity may be represented as status events.

## Compatibility and migration

- Existing settings without the new field are migrated with `forceEagerResearch: false`.
- Existing chat files and `ResearchAnswer` values remain readable.
- Existing note tool schemas remain backward compatible.
- No provider adapter may claim agentic support unless its request mapping and streamed response parsing are covered by contract tests.

## Project structure

Expected ownership, subject to implementation planning:

- `src/client/chat/` — provider-neutral model-round contract and provider mappings.
- `src/research/` — policy controller, research tools, evidence registry, fallback selection.
- `src/indexing/` — description sampling, generation, persistence lifecycle, and freshness.
- `src/settings/` — capabilities, migration, probing/manual controls.
- `src/ui/` — status/diagnostic presentation without raw reasoning.
- `tests/unit/` — contracts, state machine, tools, citations, fallback, migrations.
- `docs/` — this specification and the later implementation plan.

## Commands

```bash
npm test
npm run lint
npm run build
npm run format
```

## Testing strategy

Unit and contract tests must cover:

1. Mandatory-tool matrix for all search modes and active-file combinations.
2. Parallel first-round calls and each missing-call repair path.
3. Specific/required choice mapping for every supported provider.
4. Fallback selection when capabilities are absent or overstated.
5. Reasoning continuation preserved across tool rounds without entering answer text.
6. Streaming tool-call assembly, malformed arguments, duplicate calls, and cancellation.
7. Index/web result limits, internal skill exclusion, and structured failures.
8. Evidence registration, deduplication, and citation validation.
9. Existing skill loading rules inside the new loop.
10. Settings and persisted-data migration.
11. Regression coverage for the current deterministic pipeline.
12. Deterministic description generation without network/model calls, no regeneration after no-change runs, minimal fallback, freshness, mode-based prompt injection, and selected-index switching.

Integration fixtures should simulate complete multi-round streams for OpenAI-compatible, Anthropic, and Ollama formats selected for the initial release.

## Boundaries

### Always

- Enforce search mode outside the model.
- Validate model tool calls and provider responses at boundaries.
- Preserve provider-required continuation data losslessly.
- Keep retrieved content untrusted.
- Maintain stable citation provenance.
- Retain deterministic fallback and regression tests.

### Ask first

- Add runtime dependencies.
- Change persisted chat schema incompatibly.
- Display or persist raw reasoning.
- Send vault content to web services beyond the configured model/search providers.
- Change semantics of explicitly attached context.

### Never

- Accept prompt compliance as proof that mandatory tools ran.
- Expose raw chain-of-thought by default.
- Allow a model to broaden the selected source mode.
- Cite data that was not registered from a successful tool result.
- Silently discard an unsupported `tool_choice` or reasoning continuation field.

## Success criteria

1. In `indexOnly`, no agentic final answer is accepted before successful `search_index` execution.
2. In `indexAndWeb`, no agentic final answer is accepted before successful `search_index` and `search_web` execution.
3. In `webOnly`, no agentic final answer is accepted before successful `search_web` execution.
4. When active-file context is enabled, no agentic final answer is accepted before successful `get_active_note`, and active content is absent from the initial prompt.
5. Missing required calls are repaired deterministically or cause a clean fallback.
6. Compatible reasoning models preserve provider continuation across every tool round.
7. Raw reasoning never appears in the answer, note export, or normal chat history.
8. Final citations resolve only to evidence returned by successful calls.
9. Incompatible profiles continue to produce answers through the existing pipeline.
10. Tests, type checking, build, and formatting pass.
11. Every index-backed request includes a bounded deterministic description of the currently selected index, generated without an LLM as part of the indexing lifecycle or through a minimal local fallback.

## Resolved design decisions

1. OpenAI Responses is the first authoritative full-reasoning target. Chat Completions remains supported without assuming lossless reasoning continuation.
2. Provider-native reasoning continuation is delivered after the first iteration, which only adds the configurable eager override and supporting strategy diagnostics.
3. A successful required search with zero results satisfies source policy.
4. `get_active_note: no-active-note` satisfies the attempted context policy, emits a warning, and does not force fallback.
5. One bootstrap repair round is allowed before deterministic fallback.
6. Fallback after a partial agentic attempt is allowed and recorded with duplicated request/cost diagnostics; partial evidence is not mixed into the fallback synthesis.
7. `search_web` returns snippets; `fetch_web_page` fetches selected pages.
8. `deepResearch` retains current eager behavior until separately specified for the agentic loop.
9. Explicitly attached files remain eagerly supplied.
10. Skills are eventually available in every search mode, including `webOnly`, and may be loaded in the first parallel call set.
11. Reasoning effort/budget becomes a per-model-profile setting in the reasoning iteration.
12. UI shows tool statuses and optional provider reasoning summaries, never raw chain-of-thought.
13. Reasoning continuation exists only within one answer loop and is not persisted across saved conversation turns.
14. Retryable mandatory-tool failures receive one retry; a remaining mandatory failure triggers fallback. Optional tool failures are returned to the model for recovery.
15. Duplicate calls reuse cached results and count against the total call budget.
16. Capabilities combine metadata, probing, and explicit manual override.

## Deferred questions

- Agentic semantics for `deepResearch`.
- Exact OpenAI Responses reasoning-effort values exposed by the profile UI.
- Anthropic and Ollama reasoning-continuation rollout order after the OpenAI Responses reference implementation.
