# Spec: Per-answer diagnostic report popover

## Objective

Move context diagnostics out of the standalone panel above Follow-ups and make them available from the assistant response they describe.

Each completed assistant response that has diagnostics receives a diagnostic icon immediately to the left of the existing copy button (visually, the new icon is directly adjacent to it). The icon is rendered only while Debug mode is enabled. Activating it opens a popup containing the complete diagnostic report and a copy-to-clipboard action. The popup closes from its top-right close button or any pointer click outside both the popup and its trigger.

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
- `src/ui/DiagnosticPopover.ts` — popup lifecycle, report rendering, and copy action
- `src/ui/diagnosticFormatting.ts` — deterministic full-report text formatting
- `src/ui/rendering.ts` — optional per-message diagnostics contract
- `src/ui/ResearchQuestionController.ts` — attach completed diagnostics to the matching assistant message
- `src/ui/IxplorerChatView.ts` — popup controller integration and removal of the old report panel
- `styles.css` — trigger and popup presentation using Obsidian tokens
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

UI actions use native `button` elements with `type`, `aria-label`, and `title`. Popup state is owned by a focused controller rather than global document state in the transcript renderer.

## Testing Strategy

- Unit-test that completion attaches diagnostics only to the corresponding last assistant response.
- Unit-test that report text includes the complete serialized diagnostics and is exactly what the copy action receives.
- Preserve existing transcript/rendering and saved-chat tests.
- Verify full tests and production build.
- Manually verify in Obsidian: Debug on/off visibility, placement, open, copy, close button, outside click, and multiple responses.

## Boundaries

- Always: keep the diagnostics field optional; use the existing clipboard helper; preserve keyboard-accessible controls; remove the old standalone report UI.
- Ask first: changing Debug mode semantics, removing expanded-context regeneration, or changing saved-chat schema version.
- Never: show diagnostics when Debug mode is off; copy only visible excerpts; add a dependency; persist diagnostics in non-debug saved chats.

## Success Criteria

1. No standalone diagnostic report is rendered above Follow-ups.
2. Every completed assistant response with diagnostics has a diagnostic icon next to the copy icon when Debug mode is enabled.
3. No diagnostic icon is rendered when Debug mode is disabled or a response has no diagnostics.
4. The popup displays the complete report and includes a copy button that copies the entire report text.
5. The popup closes via its top-right close button and on any pointer click outside the popup and trigger.
6. Diagnostics remain associated with the correct response after saving and reopening a debug-mode chat; existing chats continue to load.
7. Automated tests and production build pass.

## Open Questions

None. “debut mode” is interpreted as Debug mode, and “любом книге” as any click outside the popup.

# Implementation Plan

## Architecture Decisions

- Add optional `contextDiagnostics` to `ChatDisplayMessage`; this is backward-compatible and avoids using the single latest `lastAnswer` for every response.
- Use a dedicated `DiagnosticPopoverController`, mirroring existing popover ownership patterns while implementing explicit outside-click and close-button behavior.
- Generate one canonical report string and use it for both popup display and clipboard contents, preventing display/copy divergence.

## Task List

### Task 1: Per-message diagnostic data

- Acceptance: completed diagnostics are attached to the matching assistant message; absent diagnostics remain absent; saved messages remain backward-compatible.
- Verify: focused controller/rendering tests pass.
- Files: `src/ui/rendering.ts`, `src/ui/ResearchQuestionController.ts`, related unit tests.
- Dependencies: none.

### Task 2: Diagnostic report popup and transcript action

- Acceptance: debug-only assistant action opens the complete report; copy uses the canonical full text; close button and outside pointer close it.
- Verify: formatting/controller tests pass and keyboard labels are present.
- Files: `src/ui/DiagnosticPopover.ts`, `src/ui/ChatTranscript.ts`, `src/ui/diagnosticFormatting.ts`, related tests.
- Dependencies: Task 1.

### Task 3: View integration and old panel removal

- Acceptance: no standalone report remains above Follow-ups; expanded-context regeneration remains separate; popup closes on view teardown and rerender safely.
- Verify: full test suite and build pass; manual Obsidian interaction check.
- Files: `src/ui/IxplorerChatView.ts`, `styles.css`.
- Dependencies: Tasks 1–2.

## Checkpoint

- All success criteria pass.
- Full tests and build are clean.
- Diff receives correctness, accessibility, architecture, security, and performance review.

## Risks and Mitigations

- Old saved chats have diagnostics only in `lastAnswer`: keep loading compatible; only newly completed responses gain per-message reports.
- Multiple popup/document listeners could leak: controller owns one listener and removes it on every close and view teardown.
- Large JSON reports could overflow: constrain popup dimensions and make the report body scrollable.
