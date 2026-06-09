# Implementation Plan: Model Settings Redesign

## Overview

Redesign the Chat Model and Embeddings settings so local provider configuration is faster to validate and less error-prone. The settings UI will support testing provider connectivity from the base URL row, show the detected provider after a successful connection, expose chat and embedding model fields as comboboxes populated from the provider, and keep model list refresh separate from full model validation.

## Architecture Decisions

- Keep available model lists and connection status as transient settings-tab UI state. Do not persist model lists in `IxplorerSettings`.
- Reuse `testChatConnection` and `testEmbeddingConnection` for `Test` actions because they already list models and validate the currently configured model.
- Add a model-list refresh path that only refreshes available models. `Refresh` must not fail because the currently selected model is absent; that validation belongs to `Test`.
- Implement model fields as editable comboboxes, preferably with `input[list]` plus a generated `datalist`, so users can either select a discovered model or type a model manually.
- Use Obsidian's `setIcon` with the `rotate-cw`/`refresh-cw` Lucide icon for the refresh button. This is the intended analogue of Font Awesome `fa-arrow-rotate-right`.
- Show the detected provider badge only after a successful provider connection. Current providers are LM Studio and Ollama.
- Use Obsidian CSS variables and compact row layouts in `styles.css`; avoid adding new color palettes or decorative UI.

## Dependency Graph

```text
Existing connection clients and provider detection
    |
    +-- Settings UI transient state
    |       |
    |       +-- Base URL row with Test and provider badge
    |       |
    |       +-- Model combobox row with Refresh and Test
    |               |
    |               +-- Settings styles
    |                       |
    |                       +-- Tests and manual verification
```

## Task 1: Introduce a Shared Settings UI Section Helper

**Description:** Refactor the duplicated Chat Model and Embeddings settings rows into a private helper in `SettingsTab`. The helper should accept labels, descriptions, setting keys, placeholders, provider-specific test and refresh callbacks, and the current transient UI state.

**Acceptance criteria:**

- [ ] Chat Model and Embeddings sections still render with their existing headings and descriptions.
- [ ] Base URL and model values are saved to the existing `IxplorerSettings` fields.
- [ ] The helper supports separate chat and embedding state without cross-contamination.
- [ ] The refactor does not change indexing, web search, or debug settings.

**Verification:**

- [ ] Type check succeeds: `npm run lint`.
- [ ] Manual check: both sections appear in the Obsidian settings tab.

**Dependencies:** None.

**Files likely touched:**

- `src/settings/SettingsTab.ts`

**Estimated scope:** Medium.

## Task 2: Add Base URL Test Button and Provider Badge

**Description:** Add a `Test` button to the right of each provider base URL input. When the test succeeds, render a provider badge between the URL input and the button. The badge label should be derived from `detectLocalModelProvider`: `LM Studio` for OpenAI-compatible `/v1` URLs and `Ollama` otherwise.

**Acceptance criteria:**

- [ ] Each base URL row displays input, optional provider badge, and `Test` button in that order.
- [ ] The provider badge is hidden before a successful test.
- [ ] The provider badge appears only after a successful connection test.
- [ ] Changing the base URL clears the previous provider badge and model list for that provider section.
- [ ] Failed tests show the existing user-facing `Notice` message and do not show a provider badge.

**Verification:**

- [ ] Unit tests for provider detection remain green.
- [ ] Manual check: LM Studio URL ending in `/v1` shows `LM Studio` after success.
- [ ] Manual check: Ollama base URL shows `Ollama` after success.

**Dependencies:** Task 1.

**Files likely touched:**

- `src/settings/SettingsTab.ts`
- `src/settings/connectionTests.ts` only if a display-label helper is introduced.
- `tests/unit/connection-tests.test.ts` only if a display-label helper is introduced.

**Estimated scope:** Small.

## Task 3: Convert Chat and Embedding Model Inputs to Comboboxes

**Description:** Replace plain text model inputs with editable comboboxes. The combobox options should come from the latest successful `Test` or `Refresh` action for that section. Users must still be able to type a model name manually.

**Acceptance criteria:**

- [ ] Chat model is editable and can be selected from discovered chat models.
- [ ] Embedding model is editable and can be selected from discovered embedding models.
- [ ] Typed values continue to be trimmed and saved into existing settings fields.
- [ ] Placeholder text is visually muted and disappears when the user starts typing through native input behavior.
- [ ] Empty model lists do not break manual input.

**Verification:**

- [ ] Manual check: select a discovered model and reload settings to confirm persistence.
- [ ] Manual check: type a custom model name and confirm it saves.
- [ ] Type check succeeds: `npm run lint`.

**Dependencies:** Tasks 1 and 2.

**Files likely touched:**

- `src/settings/SettingsTab.ts`
- `styles.css`

**Estimated scope:** Medium.

## Task 4: Add Model List Refresh Button and Move Test Beside Model Selection

**Description:** Add an icon-only refresh button immediately to the right of each model combobox. Use the Obsidian/Lucide icon that matches `fa-arrow-rotate-right`, preferably `rotate-cw` or `refresh-cw` depending on availability. Move the model validation `Test` button to the right of the model controls.

**Acceptance criteria:**

- [ ] Each model row displays combobox, refresh icon button, and `Test` button in that order.
- [ ] The refresh button uses a near-closed circular arrow icon equivalent to `fa-arrow-rotate-right`.
- [ ] The refresh button has an accessible label and tooltip such as `Refresh model list`.
- [ ] `Refresh` updates the available model list only.
- [ ] `Refresh` does not validate whether the currently selected model exists.
- [ ] `Test` validates both provider connectivity and the currently configured model.
- [ ] Buttons are disabled or guarded while their own request is in flight.

**Verification:**

- [ ] Manual check: `Refresh` repopulates the combobox without changing the selected model.
- [ ] Manual check: `Test` reports a missing configured model when the selected model is not available.
- [ ] Keyboard order is URL input, URL test, model combobox, refresh, model test.

**Dependencies:** Task 3.

**Files likely touched:**

- `src/settings/SettingsTab.ts`
- `styles.css`

**Estimated scope:** Medium.

## Task 5: Add Compact Responsive Settings Styles

**Description:** Add CSS classes for the new settings control groups. The layout should work in the Obsidian settings pane, preserve readable labels and descriptions, keep icon buttons stable, and make placeholders more subdued.

**Acceptance criteria:**

- [ ] Control rows wrap cleanly in narrow settings panes.
- [ ] Inputs and comboboxes have stable widths without causing overlapping text.
- [ ] The provider badge is visually secondary but readable.
- [ ] Placeholder styling is more muted than normal input text.
- [ ] Icon-only refresh buttons have stable square dimensions.

**Verification:**

- [ ] Manual check in the Obsidian settings pane at normal and narrow widths.
- [ ] Build succeeds: `npm run build`.

**Dependencies:** Tasks 2, 3, and 4.

**Files likely touched:**

- `styles.css`

**Estimated scope:** Small.

## Task 6: Extend Tests Around Connection and Refresh Semantics

**Description:** Preserve existing connection tests and add focused coverage for any new pure helpers introduced for display labels, state transitions, or refresh-only model listing. Avoid DOM-heavy tests unless a test harness already supports Obsidian setting controls.

**Acceptance criteria:**

- [ ] Existing connection tests still cover successful connections, missing configured models, provider errors, and provider detection.
- [ ] If a provider display-label helper is added, it is covered by unit tests.
- [ ] If refresh-only list helpers are added, tests assert that they return models without checking the configured model.
- [ ] Tests do not require a live LM Studio or Ollama server.

**Verification:**

- [ ] Targeted tests pass: `npm test -- connection-tests`.
- [ ] Full test suite passes: `npm test`.
- [ ] Build succeeds: `npm run build`.

**Dependencies:** Tasks 2 and 4.

**Files likely touched:**

- `tests/unit/connection-tests.test.ts`
- Optional new helper test under `tests/unit/`

**Estimated scope:** Small.

## Checkpoint: UI Behavior

- [ ] Base URL rows include a right-side `Test` button.
- [ ] Successful base URL tests show the provider badge between the input and `Test`.
- [ ] Chat and embedding model fields are editable comboboxes.
- [ ] Refresh buttons use the circular arrow icon equivalent to `fa-arrow-rotate-right`.
- [ ] `Refresh` only updates model options.
- [ ] `Test` validates provider connectivity and the selected model.

## Checkpoint: Complete

- [ ] `npm run lint` passes.
- [ ] `npm test` passes.
- [ ] `npm run build` passes.
- [ ] Manual Obsidian settings check passes for LM Studio and Ollama.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Native `datalist` rendering feels inconsistent in Obsidian/Electron. | Medium | Start with `input[list]`; replace with a small custom dropdown only if manual testing shows poor UX. |
| Obsidian `Setting` control layout resists the required ordering. | Medium | Build custom grouped elements inside `setting.controlEl` while preserving Obsidian labels and descriptions. |
| The exact `rotate-cw` icon name may differ by Obsidian/Lucide version. | Low | Try `rotate-cw`; fall back to `refresh-cw`, which is already used elsewhere in the project. |
| A stale model list could remain after URL edits. | Medium | Clear model options and provider badge whenever the relevant base URL changes. |
| Test and refresh requests can race. | Low | Track per-section loading state and ignore or disable overlapping actions. |

## Open Questions

- Should a successful `Refresh` also show the provider badge, or should only `Test` do that? Current plan keeps the badge tied to a successful provider connection, so either successful action can reasonably set it if refresh also proves connectivity.
- Should empty model lists show inline helper text, or is the existing `Notice` enough for this iteration?
