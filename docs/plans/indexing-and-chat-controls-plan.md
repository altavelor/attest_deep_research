# Implementation Plan: Indexing Controls and Chat Input Updates

## Overview

Implement the new settings and chat requirements around model selection, index visibility, and indexing lifecycle control. The main deliverable is a reusable index control element that appears in Settings > Indexing and can also replace the current chat index status line, while preserving chat ergonomics such as Enter-to-send, Shift+Enter for line breaks, and model selection near the chat input.

## Current State

- `src/settings/SettingsTab.ts` renders Chat Model, Embeddings, Indexing, Web Search, and Debug settings.
- Chat and embedding model rows currently include a model `Test` button. The new requirement keeps `Test` only beside `Provider base URL`.
- Model choices are implemented with native `input[list]` and a `datalist`. Current browser behavior can filter the opened list down to the selected value.
- `src/indexing/IndexingService.ts` already exposes `manualReindex()`, `pause()`, `resume()`, `rebuild()`, and `getState()`.
- `IndexingState` currently includes status, scanned files, indexed files, skipped files, embedded chunks, and last indexed date, but does not include total files, progress percentage, or index size on disk.
- `src/main.ts` creates retrieval services on demand, but does not yet maintain a shared `IndexingService` instance or pass index state/actions into `IxplorerChatView`.
- `src/ui/IxplorerChatView.ts` currently renders a text-only index status in the header and a refresh icon button, plus a textarea, Web toggle, and Ask button.

## Architecture Decisions

- Create one reusable index control renderer/component for both Settings and Chat rather than duplicating markup and lifecycle logic.
- Keep provider connection `Test` actions in settings, and remove model-row `Test` buttons. Model rows should retain refresh and editable model selection.
- Replace or augment native `datalist` model selection with a small custom combobox if needed to guarantee that opening the dropdown clears the filter and shows all known models.
- Introduce an `IndexingController` or equivalent plugin-level facade that owns index service creation, current state, in-flight jobs, progress subscriptions, and user actions.
- Extend index state with UI-ready fields: total scannable files, progress, last update date, index disk size, and active operation.
- Make chat-specific visibility of the index control a persisted setting so users can hide the control from the chat view.
- Use Obsidian/Lucide icons for indexing actions: play for Start, pause for Pause, play/rotate for Continue, and refresh/recycle for Rebuild.
- The indexing control's interrupted-running action is labeled Pause/Continue, not Stop/Continue.
- The chat index control can be hidden only from the chat view itself; Settings should not expose a separate hide/show control for it.
- Changes to include/exclude folders should mark the index as stale and prompt the user to rebuild.
- Chat model options are loaded only after the user refreshes or tests the provider; chat open should not automatically fetch models.

## Dependency Graph

```text
Settings schema migration
    |
    +-- Indexing state/type extensions
    |       |
    |       +-- Plugin-level indexing controller
    |       |       |
    |       |       +-- Reusable index control renderer
    |       |               |
    |       |               +-- Settings Indexing section
    |       |               +-- Chat index control replacement
    |       |
    |       +-- Indexing progress and disk-size tests
    |
    +-- Model selector dropdown behavior
    |
    +-- Chat input and model selector UI
            |
            +-- Chat request uses selected model
```

## Phase 1: Settings and Shared Contracts

### Task 1: Extend Settings for Chat UI Preferences

**Description:** Add persisted settings needed by the new chat controls, especially whether the index control is shown in the chat pane.

**Acceptance criteria:**

- [ ] `IxplorerSettings` includes a setting such as `showChatIndexControl`.
- [ ] Default value shows the chat index control unless the user hides it.
- [ ] `migrateSettings()` handles missing older values without breaking existing saved data.
- [ ] Existing model, indexing, web, and debug settings continue to migrate unchanged.

**Verification:**

- [ ] Unit tests cover defaults and migration in `tests/unit/settings.test.ts`.
- [ ] Type check succeeds: `npm run lint`.

**Dependencies:** None.

**Files likely touched:**

- `src/settings/settings.ts`
- `tests/unit/settings.test.ts`

**Estimated scope:** Small.

### Task 2: Extend Indexing State for UI Requirements

**Description:** Expand `IndexingState` so the UI can show current status, indexed file count, last update date, index disk size, and active scan progress.

**Acceptance criteria:**

- [ ] State includes total files for the current scan or enough data to compute progress.
- [ ] State exposes index disk size in bytes or a display-ready value derived from bytes.
- [ ] State distinguishes idle, indexing, paused, and stale/rebuild-needed behavior.
- [ ] State remains serializable and easy to copy for UI subscribers.

**Verification:**

- [ ] Unit tests cover progress state during `manualReindex()`.
- [ ] Unit tests cover state after idle completion, pause, resume, clear, and rebuild.
- [ ] Type check succeeds: `npm run lint`.

**Dependencies:** Task 1 only if settings references are needed in tests; otherwise none.

**Files likely touched:**

- `src/indexing/IndexingService.ts`
- `tests/unit/indexing-service.test.ts`
- `tests/unit/indexing-performance.test.ts`
- `src/ui/rendering.ts`

**Estimated scope:** Medium.

## Phase 2: Indexing Controller and Control Component

### Task 3: Add Plugin-Level Indexing Controller

**Description:** Add a controller owned by `IxplorerPlugin` that creates and holds the active `IndexingService`, exposes current state, handles start/pause/resume/rebuild actions, and notifies UI consumers when state changes.

**Acceptance criteria:**

- [ ] `IxplorerPlugin` exposes indexing state and actions to settings and chat views.
- [ ] Starting indexing launches one active indexing job at a time.
- [ ] Pause and Continue operate on the same service instance when possible.
- [ ] Rebuild clears the index and starts a full reindex.
- [ ] Errors surface as Obsidian notices and leave the UI in a recoverable state.

**Verification:**

- [ ] Unit tests cover controller state transitions if implemented as a testable class.
- [ ] Manual check: starting, pausing, continuing, and rebuilding do not create overlapping jobs.
- [ ] Build succeeds: `npm run build`.

**Dependencies:** Task 2.

**Files likely touched:**

- `src/main.ts`
- Optional new file: `src/indexing/IndexingController.ts`
- `src/indexing/IndexingService.ts`
- `tests/unit/indexing-controller.test.ts`

**Estimated scope:** Medium.

### Task 4: Compute and Format Index Disk Size

**Description:** Add a small utility path for measuring the configured LanceDB folder size and formatting it for the status row.

**Acceptance criteria:**

- [ ] The index control can display a human-readable size such as `0 B`, `42 KB`, or `18.5 MB`.
- [ ] Missing or inaccessible index folders are handled as `0 B` or `Unavailable` without throwing into the UI.
- [ ] The measurement works with Obsidian's local `FileSystemAdapter`; non-local adapters degrade gracefully.

**Verification:**

- [ ] Unit tests cover size formatting.
- [ ] Manual check: settings shows a plausible size after an index run.

**Dependencies:** Task 3.

**Files likely touched:**

- Optional new file: `src/indexing/indexSize.ts`
- `src/main.ts`
- `tests/unit/index-size.test.ts`

**Estimated scope:** Small.

### Task 5: Build a Reusable Index Control Renderer

**Description:** Create a shared UI renderer for the three-level indexing control required by both Settings and Chat.

**Acceptance criteria:**

- [ ] First level shows status, indexed file count, last update date, and index disk size.
- [ ] Second level appears only during active indexing and shows a progress bar for the current scan.
- [ ] Third level shows Start, Pause or Continue, and Rebuild controls with meaningful icons.
- [ ] Buttons reflect current state: Start disabled while indexing, Continue shown or enabled when paused, Rebuild guarded while another destructive rebuild is in flight.
- [ ] The renderer can be mounted in Settings and Chat without importing `PluginSettingTab` details.

**Verification:**

- [ ] Unit tests cover pure formatting helpers.
- [ ] Manual check: control updates while indexing is running.
- [ ] Manual check: keyboard focus and button labels are accessible.

**Dependencies:** Tasks 3 and 4.

**Files likely touched:**

- Optional new file: `src/ui/IndexControl.ts`
- `src/ui/rendering.ts`
- `styles.css`
- `tests/unit/chat-rendering.test.ts`

**Estimated scope:** Medium.

## Phase 3: Settings UI Changes

### Task 6: Remove Model-Level Test Buttons

**Description:** Update Chat Model and Embeddings settings so `Test` appears only beside `Provider base URL`. Model rows should keep editable selection and model-list refresh.

**Acceptance criteria:**

- [ ] Provider base URL rows still include a `Test` button.
- [ ] Chat model and embedding model rows no longer include `Test` buttons.
- [ ] Refresh buttons still update the available model list.
- [ ] Existing provider test behavior still validates connectivity and current configured model, unless deliberately split in a later spec.

**Verification:**

- [ ] Manual check: settings contains exactly one `Test` button per provider section, both next to base URLs.
- [ ] Build succeeds: `npm run build`.

**Dependencies:** None.

**Files likely touched:**

- `src/settings/SettingsTab.ts`
- `styles.css` only if row spacing needs cleanup.

**Estimated scope:** Small.

### Task 7: Reset Model Dropdown Filter When Opened

**Description:** Ensure opening a model selector through its dropdown button shows all known models instead of only the currently selected value.

**Acceptance criteria:**

- [ ] When the model selector is opened, the visible list is not filtered to the current selected value.
- [ ] Users can still type to filter or enter a custom model name.
- [ ] Selecting a model persists to the existing setting.
- [ ] The solution works for both chat and embedding model selectors.

**Verification:**

- [ ] Manual check: select a model, close settings, reopen dropdown, and confirm all known models are visible.
- [ ] Manual check: typed custom models still save.
- [ ] Type check succeeds: `npm run lint`.

**Dependencies:** Task 6.

**Files likely touched:**

- `src/settings/SettingsTab.ts`
- `styles.css`
- Optional new file: `src/ui/ModelCombobox.ts`

**Estimated scope:** Medium.

### Task 8: Add Index Control to Settings > Indexing

**Description:** Mount the reusable index control in the existing Indexing section, above or below the LanceDB folder and include/exclude path settings.

**Acceptance criteria:**

- [ ] The Indexing section includes the three-level index control.
- [ ] The control uses live plugin-level state and actions.
- [ ] Changing LanceDB folder or include/exclude settings marks the index as stale and prompts the user to rebuild.
- [ ] Stale/rebuild-needed status is visible in the index control without starting a scan automatically.
- [ ] Existing LanceDB folder, included folders, and excluded globs settings remain editable.

**Verification:**

- [ ] Manual check: Settings > Indexing can start, pause/continue, and rebuild indexing.
- [ ] Manual check: progress bar appears only during active scans.
- [ ] Build succeeds: `npm run build`.

**Dependencies:** Tasks 3, 5, and 6.

**Files likely touched:**

- `src/settings/SettingsTab.ts`
- `src/main.ts`
- `styles.css`

**Estimated scope:** Medium.

## Phase 4: Chat UI Changes

### Task 9: Implement Enter-to-Send and Shift+Enter Newline

**Description:** Update the chat textarea keyboard handling so Enter submits the request and Shift+Enter inserts a newline.

**Acceptance criteria:**

- [ ] Pressing Enter in the textarea submits the question.
- [ ] Pressing Shift+Enter inserts a newline.
- [ ] Empty or whitespace-only input is not submitted.
- [ ] Behavior does not double-submit through the form `submit` handler.
- [ ] The Ask button still submits normally.

**Verification:**

- [ ] Manual check in Obsidian chat pane.
- [ ] Unit or DOM-level test if a lightweight test harness exists; otherwise document manual verification.

**Dependencies:** None.

**Files likely touched:**

- `src/ui/IxplorerChatView.ts`

**Estimated scope:** Small.

### Task 10: Add Chat Model Selector Under Input

**Description:** Add a chat model selector below the textarea and before the Web toggle, using the configured chat model list after explicit refresh/test actions and persisting changes to `chatModel`.

**Acceptance criteria:**

- [ ] A chat model selector appears under the input before the Web toggle.
- [ ] The selector initializes from `settings.chatModel`.
- [ ] Changing the selector persists to settings and affects subsequent chat requests.
- [ ] The selector shows available model options only after the user refreshes the model list or tests the provider.
- [ ] Opening the chat view does not automatically fetch chat model options.
- [ ] The selector degrades to manual entry if no list has been loaded.
- [ ] The selector does not interfere with Enter-to-send behavior.

**Verification:**

- [ ] Manual check: refresh or test provider, select a chat model in the chat pane, submit a question, and confirm the request uses the selected model.
- [ ] Manual check: Web toggle remains after the selector and continues to respect `duckDuckGoEnabled`.
- [ ] Build succeeds: `npm run build`.

**Dependencies:** Task 7 if using the same combobox, otherwise Task 1 for settings persistence.

**Files likely touched:**

- `src/ui/IxplorerChatView.ts`
- `src/main.ts`
- `src/settings/settings.ts`
- Optional shared model selector file
- `styles.css`

**Estimated scope:** Medium.

### Task 11: Replace Chat Status with Hideable Index Control

**Description:** Replace the current text-only chat index status and refresh button with the reusable index control from settings, and add a way to hide it.

**Acceptance criteria:**

- [ ] Chat header no longer uses the old text-only index status element.
- [ ] Chat displays the reusable index control when `showChatIndexControl` is enabled.
- [ ] User can hide the chat index control from the chat view.
- [ ] Settings does not expose a separate hide/show control for the chat index control.
- [ ] Hidden state persists across plugin reloads.
- [ ] When hidden, the chat layout still has no awkward empty header area.

**Verification:**

- [ ] Manual check: hide the control, reload Obsidian, confirm it stays hidden.
- [ ] Manual check: show it again from the chat view reveal path.
- [ ] Build succeeds: `npm run build`.

**Dependencies:** Tasks 1, 5, and 8.

**Files likely touched:**

- `src/ui/IxplorerChatView.ts`
- `src/main.ts`
- `styles.css`

**Estimated scope:** Medium.

## Phase 5: Styling, Tests, and Verification

### Task 12: Add Responsive Styles for New Controls

**Description:** Style the index control, progress bar, chat model selector row, and updated settings rows using Obsidian variables and compact layouts.

**Acceptance criteria:**

- [ ] Controls fit narrow Obsidian panes without overlapping.
- [ ] Icon buttons have stable square dimensions and accessible labels/tooltips.
- [ ] Progress bar has clear filled and empty states.
- [ ] Chat actions remain readable with selector, Web toggle, and Ask button.
- [ ] Styling does not introduce a new dominant color palette.

**Verification:**

- [ ] Manual check in narrow and normal settings panes.
- [ ] Manual check in narrow and normal chat pane widths.
- [ ] Build succeeds: `npm run build`.

**Dependencies:** Tasks 5, 8, 10, and 11.

**Files likely touched:**

- `styles.css`

**Estimated scope:** Small.

### Task 13: Final Regression Pass

**Description:** Run targeted and full verification for settings, indexing, and chat behavior.

**Acceptance criteria:**

- [ ] All existing unit tests pass.
- [ ] New tests cover settings migration, index state/progress formatting, and any controller utilities.
- [ ] Manual Obsidian checks cover provider testing, model dropdown reset, indexing controls, chat submission, chat model selection, Web toggle, and hiding the index control.

**Verification:**

- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] Manual checklist updated if needed in `docs/manual-test-checklist.md`.

**Dependencies:** Tasks 1-12.

**Files likely touched:**

- Tests under `tests/unit/`
- `docs/manual-test-checklist.md` if checklist updates are in scope

**Estimated scope:** Small.

## Checkpoints

### Checkpoint: Contracts Ready

- [ ] Settings migration is complete.
- [ ] Indexing state exposes all data needed by the UI.
- [ ] Existing tests still pass.

### Checkpoint: Index Control Works in Settings

- [ ] Plugin-level indexing controller prevents overlapping jobs.
- [ ] Settings > Indexing shows status, progress, and action buttons.
- [ ] Start, pause/continue, and rebuild work manually.

### Checkpoint: Chat UX Complete

- [ ] Enter submits and Shift+Enter inserts a newline.
- [ ] Chat model selector appears below the input before Web.
- [ ] Chat index control replaces old status and can be hidden persistently.

### Checkpoint: Release Candidate

- [ ] `npm run lint` passes.
- [ ] `npm test` passes.
- [ ] `npm run build` passes.
- [ ] Manual Obsidian verification passes.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Native `datalist` cannot reliably show all options after a value is selected. | Medium | Implement a small custom combobox shared by settings and chat model selector. |
| Indexing `pause()` is currently closer to pause/stop because `manualReindex()` exits when paused. | Medium | Preserve the required Pause/Continue labels and adjust service/controller behavior so Continue resumes the remaining work, then add tests for that behavior. |
| Computing folder size may be unavailable on non-local vault adapters. | Low | Display `Unavailable` and keep controls functional. |
| Rebuild while indexing can cause race conditions. | High | Route all actions through one controller with an in-flight operation guard. |
| Settings changes during active indexing may leave the service using stale paths or models. | Medium | Mark the index as stale after LanceDB folder or include/exclude changes, prompt for Rebuild, and avoid applying path changes to an active scan mid-run. |
| Chat model selector needs model options, but settings model lists are currently transient inside `SettingsTab`. | Medium | Move available chat model options into shared plugin-level model state and populate it only from explicit refresh/test actions. |

## Resolved Decisions

- The interrupted-running indexing control is labeled Pause/Continue.
- The chat index control can be hidden only from the chat view.
- Changing include/exclude folders marks the index as stale and prompts for Rebuild.
- Chat model options load only after explicit refresh or provider test actions.
