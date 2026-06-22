# Spec: Per-answer diagnostic report popover

Readable agent-run diagnostics and HTML export are specified separately in `docs/diagnostic-report-readable-spec.md`. This document remains authoritative for the base per-answer popover lifecycle and compatibility behavior.

## Objective

Move context diagnostics out of the standalone panel above Follow-ups and make them available from the assistant response they describe.

Each completed assistant response that has diagnostics receives a diagnostic icon immediately to the left of the existing copy button (visually, the new icon is directly adjacent to it). The icon is rendered only while Debug mode is enabled. Activating it opens an app-level Obsidian modal containing the complete diagnostic report. The modal defaults to a readable structured view and provides a keyboard-accessible `Readable / Raw` segmented switch. `Raw` shows the canonical plain-text report, including its structured JSON debug details.

The modal header contains three actions before Close: `Copy raw report`, `Download readable HTML`, and the `Readable / Raw` switch. Download generates a self-contained `.html` file from the same redacted `ContextDiagnostics` snapshot and follows the information hierarchy demonstrated by `docs/diagnostic-report-readable.html`. The modal closes from its top-right close button or any pointer click on the overlay, stays above the full application, supports width/height resizing, and shows report scrollbars only when content overflows.

Diagnostics are attached to the corresponding assistant message so multiple generated responses and saved chat history retain the correct report. This is an additive optional field and remains compatible with existing saved chats.

The existing “Regenerate with expanded context” action is not part of the diagnostic report and remains available as a separate answer action above Follow-ups.

## Tech Stack

- TypeScript 5
- Obsidian DOM helpers and icon API
- Vitest 1
- Existing CSS design tokens from `styles.css`

## Commands

- Focused tests: `npm test -- --run tests/unit/chat-rendering.test.ts tests/unit/diagnostic-formatting.test.ts`
- Full tests: `npm test`
- Type/build verification: `npm run build`
- Type-only verification: `npm run lint`

## Project Structure

- `src/ui/ChatTranscript.ts` — assistant response actions and diagnostic trigger
- `src/ui/DiagnosticReportModal.ts` — app-level modal lifecycle, report rendering, and copy action
- `src/ui/diagnosticFormatting.ts` — deterministic full-report text formatting
- `src/ui/diagnosticHtml.ts` — deterministic, escaped, self-contained readable HTML generation
- `src/ui/rendering.ts` — optional per-message diagnostics contract
- `src/ui/ResearchQuestionController.ts` — attach completed diagnostics to the matching assistant message
- `src/ui/IxplorerChatView.ts` — modal controller integration and removal of the old report panel
- `styles.css` — trigger and resizable modal presentation using Obsidian tokens
- `tests/unit/` — regression tests for message attachment and report formatting

## Code Style

Use additive optional contracts and explicit callbacks:

```ts
export interface ChatDisplayMessage {
  role: "user" | "assistant";
  content: string;
  contextDiagnostics?: ContextDiagnostics;
}
```

UI actions use native `button` elements with `type`, `aria-label`, and `title`. Modal state is owned by a focused controller rather than global document state in the transcript renderer.

## Testing Strategy

- Unit-test that completion attaches diagnostics only to the corresponding last assistant response.
- Unit-test that report text includes the complete serialized diagnostics and is exactly what `Copy raw report` receives in either view.
- Unit-test readable DOM rendering and standalone HTML generation from the same diagnostics fixture.
- Test escaping with HTML/script sentinels and verify that downloaded HTML contains no remote resources or executable scripts.
- Preserve existing transcript/rendering and saved-chat tests.
- Verify full tests and production build.
- Manually verify in Obsidian: Debug on/off visibility, app-level stacking, resize, conditional scrollbars, copy, close button, overlay click, and multiple responses.

## Boundaries

- Always: keep the diagnostics field optional; use the existing clipboard helper; preserve keyboard-accessible controls; remove the old standalone report UI; derive readable, raw, and downloaded representations from one immutable diagnostic snapshot.
- Ask first: changing Debug mode semantics, removing expanded-context regeneration, or changing saved-chat schema version.
- Never: show diagnostics when Debug mode is off; copy only visible excerpts; add a dependency; persist diagnostics in non-debug saved chats; interpolate unescaped diagnostics into HTML; include scripts, remote fonts, images, stylesheets, or private data excluded by diagnostic redaction policy.

## Success Criteria

1. No standalone diagnostic report is rendered above Follow-ups.
2. Every completed assistant response with diagnostics has a diagnostic icon next to the copy icon when Debug mode is enabled.
3. No diagnostic icon is rendered when Debug mode is disabled or a response has no diagnostics.
4. The modal opens in `Readable` mode, displays a structured summary, and switches to the complete canonical raw report without closing or losing scroll state for the other view.
5. `Copy raw report` copies the same complete canonical text regardless of the selected view.
6. `Download readable HTML` downloads a deterministic, self-contained, redacted UTF-8 HTML document that can be opened without Obsidian or network access.
7. Readable modal content and downloaded HTML present the same sections, values, warnings, and failure states; absence of an optional section is represented consistently.
8. The switch and both actions have accessible names, visible focus states, and keyboard operation.
9. The modal closes via its top-right close button and on any pointer click on its overlay.
10. The modal is rendered above the full Obsidian application, can be resized in both dimensions, and exposes vertical/horizontal scrollbars only when the report overflows.
11. Diagnostics remain associated with the correct response after saving and reopening a debug-mode chat; existing chats continue to load.
12. Automated tests and production build pass.

## Open Questions

None. “debut mode” is interpreted as Debug mode, and “любом книге” as any click outside the popup.

# Implementation Plan

## Architecture Decisions

- Add optional `contextDiagnostics` to `ChatDisplayMessage`; this is backward-compatible and avoids using the single latest `lastAnswer` for every response.
- Use a dedicated `DiagnosticReportModalController` backed by Obsidian `Modal`, so stacking, overlay close, Escape, and application-level placement follow native behavior.
- Generate one canonical report string and use it for both popup display and clipboard contents, preventing display/copy divergence.
- Build a provider-neutral `DiagnosticReportViewModel` once from `ContextDiagnostics`; use it for readable modal DOM and standalone HTML so their semantic content cannot drift.
- Render readable modal content with Obsidian DOM helpers. Generate download HTML with an explicit escaping function and static local CSS; do not inject the example HTML or use `innerHTML` for modal rendering.
- Default to `Readable`; retain independent scroll positions for readable and raw panels during the modal lifetime.
- Download through an object URL created from a UTF-8 `Blob`, trigger a temporary anchor with a sanitized `ixplorer-diagnostic-<runId-or-timestamp>.html` filename, and always revoke the URL.

## Task List

### Task 1: Per-message diagnostic data

- Acceptance: completed diagnostics are attached to the matching assistant message; absent diagnostics remain absent; saved messages remain backward-compatible.
- Verify: focused controller/rendering tests pass.
- Files: `src/ui/rendering.ts`, `src/ui/ResearchQuestionController.ts`, related unit tests.
- Dependencies: none.

### Task 2: Canonical diagnostic view model and formatters

- Acceptance: one immutable view model drives canonical raw text, readable sections, and deterministic standalone HTML; all external strings are escaped and the HTML has no script or remote resources.
- Verify: formatting snapshots cover complete, partial, warning, failure, and hostile-string fixtures; semantic parity assertions compare readable sections with downloaded HTML.
- Files: `src/ui/diagnosticFormatting.ts`, new `src/ui/diagnosticHtml.ts`, `tests/unit/diagnostic-formatting.test.ts`, new HTML formatter tests.
- Dependencies: Task 1.

### Task 3: Diagnostic report modal modes and actions

- Acceptance: debug-only assistant action opens in readable mode; the accessible switch changes between readable and raw panels; copy always uses canonical raw text; download produces readable HTML; close button and outside pointer close the modal.
- Verify: modal tests cover switch state, independent scroll restoration, copy payload, Blob filename/content, URL revocation, and keyboard labels.
- Files: `src/ui/DiagnosticReportModal.ts`, `src/ui/ChatTranscript.ts`, `styles.css`, related tests.
- Dependencies: Task 2.

### Task 4: View integration and old panel removal

- Acceptance: no standalone report remains above Follow-ups; expanded-context regeneration remains separate; popup closes on view teardown and rerender safely.
- Verify: full test suite and build pass; manual Obsidian interaction check.
- Files: `src/ui/IxplorerChatView.ts`, `styles.css`.
- Dependencies: Tasks 1–3.

## Checkpoint

- All success criteria pass.
- Full tests and build are clean.
- Diff receives correctness, accessibility, architecture, security, and performance review.

## Risks and Mitigations

- Old saved chats have diagnostics only in `lastAnswer`: keep loading compatible; only newly completed responses gain per-message reports.
- Multiple modal instances could conflict: controller closes the previous modal before opening another and on view teardown.
- Large JSON reports could overflow: constrain modal dimensions, keep the report body scrollable, and expose stable scrollbars.
- Readable and raw representations could diverge: derive both from one view model and test semantic parity rather than duplicated handcrafted templates.
- Diagnostic strings could become active HTML: escape every external value, prohibit scripts and remote resources, and cover hostile sentinels in tests.
- Object URLs could leak: create them only on download and revoke them in a `finally`-equivalent cleanup after triggering the anchor.
