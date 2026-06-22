# Spec: Agent-run diagnostic report and readable HTML

## Status

Accepted on 2026-06-21. This specification extends `docs/diagnostic-report-popover.md` and is authoritative for diagnostics introduced by the universal reasoning-streaming plan, the readable modal view, and standalone HTML export.

## Objective

Make failures in the provider-neutral reasoning pipeline localizable from one per-answer report. A developer must be able to determine whether reasoning was lost in transport, stream parsing, `AgentRun`, `ResearchProgressProjector`, UI delivery, or persistence without inspecting raw provider payloads or private reasoning.

The same immutable, redacted diagnostic snapshot produces:

1. a readable structured view inside the existing diagnostic modal;
2. the canonical raw plain-text report with structured JSON debug details;
3. a downloadable, self-contained readable HTML report.

## Relationship to existing diagnostics

- `ContextDiagnostics` remains the backward-compatible root contract.
- New diagnostic groups are additive optional fields; older saved chats and reports remain readable.
- `docs/diagnostic-report-popover.md` remains authoritative for per-message attachment, Debug-mode visibility, modal placement, closing, resizing, and lifecycle.
- `docs/diagnostic-report-readable.html` is a visual and information-hierarchy reference, not a runtime template or source file.
- Existing retrieval, graph, web, index, skill, tool, and budget diagnostics remain available.

## Diagnostic contract

```ts
interface ContextDiagnostics {
  reportSchemaVersion?: 2;
  run?: RunDiagnostics;
  attempts?: AttemptDiagnostics[];
  stream?: StreamDiagnostics;
  projection?: ProjectionDiagnostics;
  delivery?: DeliveryDiagnostics;
}
```

### Run identity and lifecycle

`RunDiagnostics` contains:

- `runId`, `answerId`, terminal status, start time, duration, and last completed phase;
- a hashed/non-secret profile identity when correlation is needed;
- configured and consumed limits for rounds, tool calls, tool-result characters, tokens, and elapsed time;
- terminal reason, cancellation/replacement reason, and the phase that produced a failure;
- bounded lifecycle timeline events carrying relative monotonic time, round, type, status, counts, and safe reason codes.

Every new diagnostic event is correlated by `runId`. The timeline is bounded to 500 entries. When truncated, it records omitted event count and retained range. It contains no reasoning text, prompt text, tool arguments, tool results, response bodies, URLs containing credentials, or opaque provider continuation values.

### Attempts and fallback

Each protocol/model attempt is represented separately with protocol, selection source, start/end status, whether any output was emitted, classified error code, and fallback decision. Cost and event counters from failed and successful attempts are not merged. A fallback records why it was permitted or rejected.

### Stream parsing

`StreamDiagnostics` records:

- selected protocol and source;
- observed event/field dialects;
- frame, malformed-frame, ignored-event, reasoning-delta, text-delta, tool-delta, and terminal-event counts;
- synthesized reasoning boundaries and conflicting alias counts;
- first-byte and first-reasoning timing;
- whether a terminal event and `[DONE]` marker were observed;
- bounded parser warnings using stable reason codes.

It never stores raw SSE/JSONL frames or response bodies.

### Projection and classification

`ProjectionDiagnostics` records reasoning segment count, checkpoints, buffered/committed character counts, final commits, stale events ignored, and duplicate deltas ignored. Each completed round has a classification decision:

```ts
interface RoundClassificationDiagnostic {
  round: number;
  classification: "intermediate" | "final" | "discarded";
  reason:
    | "pending-tool-calls"
    | "explicit-continuation"
    | "terminal-no-tools"
    | "cancelled"
    | "replaced"
    | "fallback-reset"
    | "invalid-terminal-state";
}
```

### UI delivery and persistence

`DeliveryDiagnostics` records projector events received, UI patches applied, coalesced updates, Markdown renders, first/last reasoning paint timing, disclosure transitions, stale run events ignored, persistence status, and reload restoration status. It stores counts and enum transitions, not rendered reasoning content.

### Capability decision trace

Capability diagnostics record independent effective states for Chat Completions reasoning, Responses reasoning, streaming, tool calls, reasoning controls, and continuation. Each entry includes value, source (`manual`, `metadata`, `passive-observation`, `probe`, or `cache`), freshness, previous source/value when changed, observed safe field name, and whether a generation probe ran.

### Deterministic failure localization

The report computes zero or more stable findings from counters rather than using an LLM. Examples:

- upstream reasoning observed but no normalized reasoning events → `stream-adapter`;
- normalized reasoning emitted but no projected segment → `research-progress-projector`;
- projected segment created but no UI patch → `ui-delivery`;
- UI rendered but saved message lacks the segment → `persistence`;
- terminal event absent after transport completion → `stream-framing`.

Each finding has `severity`, `code`, `likelyLayer`, and a short actionable explanation. Findings must not claim certainty when evidence is incomplete.

## Diagnostic report view model

`buildDiagnosticReportViewModel(diagnostics)` is pure and creates the only semantic representation used by readable DOM and HTML:

```ts
interface DiagnosticReportViewModel {
  title: string;
  identity: DiagnosticIdentityView;
  outcome: DiagnosticOutcomeView;
  findings: DiagnosticFindingView[];
  metrics: DiagnosticMetricView[];
  sections: DiagnosticSectionView[];
  timeline: DiagnosticTimelineItemView[];
  rawReport: string;
}
```

Section order is deterministic:

1. outcome and likely failure layer;
2. run identity and attempts;
3. primary metrics and budgets;
4. lifecycle timeline;
5. reasoning stream and parser;
6. research projection;
7. UI delivery and persistence;
8. capabilities and fallback;
9. tools, context, retrieval, web, index, and skills;
10. warnings and redaction/truncation notices.

Unknown optional sections are omitted. Known empty sections show an explicit empty state only when absence is diagnostically meaningful.

## Modal behavior

- The modal opens in `Readable` mode.
- A native keyboard-accessible segmented control switches between `Readable` and `Raw` without recreating the modal.
- Each panel retains its own scroll position for the modal lifetime.
- `Raw` renders the canonical `formatDiagnosticReport()` output as text.
- `Copy raw report` always copies that canonical raw report, independent of selected mode.
- `Download readable HTML` is available in either mode.
- Existing Close, Escape, overlay click, resize, and overflow behavior remains unchanged.
- UI uses existing Obsidian tokens and does not restyle the chat transcript.

## Readable HTML export

`formatDiagnosticReportHtml(viewModel)` returns deterministic UTF-8 HTML that:

- is a complete document with semantic headings, tables/lists, timeline, and print styles;
- uses embedded static CSS and `color-scheme: light dark`;
- contains no JavaScript, event handlers, forms, remote resources, external URLs, or data URLs;
- escapes every diagnostic-derived text and attribute value;
- contains the same semantic sections, values, findings, warnings, and empty states as readable modal DOM;
- includes report schema version and generation timestamp but no environment secrets;
- remains useful when opened offline or printed to PDF.

Download uses a UTF-8 `Blob`, temporary object URL, and sanitized filename `ixplorer-diagnostic-<runId-or-timestamp>.html`. The object URL is always revoked after the download is triggered.

## Redaction and bounds

Never include API keys, authorization headers, raw prompts, full reasoning, note/page contents, raw tool arguments/results, encrypted reasoning, response bodies, raw SSE events, or provider continuation identifiers.

Allowed values are stable enum codes, counters, durations, token/character sizes, safe field/event names, hashes designed for diagnostics, and bounded non-content labels. Existing diagnostic text that can contain user/provider values is escaped for HTML and remains subject to the existing redaction policy.

The raw, readable, and HTML representations must be generated from the same already-redacted snapshot. Formatting is not a redaction boundary.

## Tech stack

- TypeScript 5
- Obsidian DOM helpers and design tokens
- Native `Blob`, object URL, and anchor download APIs
- Vitest 1
- No new runtime dependency

## Commands

- Focused tests: `npm test -- --run tests/unit/diagnostic-formatting.test.ts tests/unit/diagnostic-html.test.ts tests/unit/diagnostic-modal.test.ts`
- Related UI tests: `npm test -- --run tests/unit/chat-rendering.test.ts tests/unit/diagnostic-modal-styles.test.ts`
- Type/build verification: `npm run lint && npm run build`
- Full verification: `npm test`

## Project structure

- `src/shared/types.ts` — additive diagnostic contracts
- `src/research/` — run, projection, capability, fallback, and persistence diagnostic producers
- `src/client/chat/` — transport/parser diagnostic producers
- `src/ui/diagnosticFormatting.ts` — raw formatter and view-model builder
- `src/ui/diagnosticHtml.ts` — pure escaped HTML formatter
- `src/ui/DiagnosticReportModal.ts` — readable/raw presentation, copy, and download actions
- `styles.css` — modal readable/raw styles using Obsidian variables
- `tests/unit/` — contract, formatter, redaction, parity, modal, and download tests

## Code style

- Add optional discriminated fields rather than weakening existing required contracts.
- Use stable machine-readable reason codes; localize human labels only in formatter/UI layers.
- Keep diagnostic producers independent of DOM and HTML.
- Keep formatters pure; inject browser download primitives into a small testable helper.
- Never build readable modal content with diagnostic-derived `innerHTML`.

## Testing strategy

- Contract tests for complete and partial diagnostics from each pipeline layer.
- Transition tests proving stale `runId` events and fallback attempts are counted correctly.
- Golden semantic fixtures for successful, unsupported, malformed-stream, cancelled, fallback, and UI-delivery failures.
- Parity tests assert the readable DOM model and HTML contain identical section IDs and semantic values.
- Security tests use distinct sentinels for every forbidden channel and hostile HTML strings.
- Bounds tests cover timeline truncation, tool-output limits, large JSON, and filename sanitation.
- Modal tests cover default mode, keyboard switching, independent scroll positions, copy payload, Blob content, and object URL revocation.
- Manual verification compares the result with `docs/diagnostic-report-readable.html` in light/dark themes and opens the downloaded file offline.

## Boundaries

### Always

- Preserve existing raw-report compatibility and per-answer association.
- Generate every representation from one immutable redacted snapshot.
- Keep reason codes stable and diagnostic fields additive.
- Revoke download object URLs and escape all HTML-derived values.

### Ask first

- Persisting diagnostics outside Debug-mode chat records.
- Adding a dependency, executable content, or remote assets to exported HTML.
- Changing existing Debug-mode or copy semantics.
- Increasing the 500-event timeline bound.

### Never

- Store or export raw/private reasoning or provider continuation state.
- Infer failure location with an LLM.
- Use provider brand checks for diagnostic classification.
- Treat HTML formatting as a substitute for source redaction.

## Success criteria

1. A report localizes missing reasoning to transport, parser, run, projector, delivery, or persistence when counters provide sufficient evidence.
2. Late events from replaced/cancelled runs are visible as counts but cannot alter the active report or UI.
3. Readable modal, raw report, and HTML export derive from one diagnostic snapshot.
4. The modal defaults to readable mode and its switch, copy, download, close, resize, and scroll behavior are accessible and deterministic.
5. Downloaded HTML is self-contained, script-free, remote-resource-free, escaped, redacted, offline-readable, and printable.
6. Readable modal and HTML contain the same semantic sections and diagnostic values.
7. Existing saved chats and diagnostics without the new optional fields remain readable.
8. Redaction and forbidden-sentinel tests pass for raw, readable DOM, persisted diagnostics, logs, and HTML.
9. Focused tests, full tests, lint, and build pass.

## Open questions

None. The defaults in this specification are accepted.
