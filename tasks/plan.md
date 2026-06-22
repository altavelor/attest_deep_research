# Plan: Note Mutation Tools

Spec: SPEC-note-mutation-tools.md

## Tasks

### Task 1 — Core types and path validation [x]
Add `VaultWriter` interface, `NoteActionConfirmation` stub, `AUTO_CONFIRM`, `validateMutablePath`,
and extend `NoteToolServiceOptions` with `writer`, `confirmation`, `noteMutationAccess`.

Files: `src/research/tools/NoteTools.ts`

Acceptance:
- `VaultWriter` interface exported with: exists, createFile, modifyFile, appendFile, readFile, trashFile, ensureFolder
- `NoteActionConfirmation` interface and `AUTO_CONFIRM` const exported
- `validateMutablePath(path)` returns `{ ok: true }` for valid `.md` paths outside `.ixplorer/`
- Returns `{ ok: false, reason: "invalid-path" }` for non-`.md`
- Returns `{ ok: false, reason: "forbidden-path" }` for `.ixplorer/` paths
- `NoteToolServiceOptions` has optional `writer`, `confirmation`, `noteMutationAccess`

---

### Task 2 — `create_note` tool [x]
Implement `create_note` tool definition and handler in `NoteToolService`.

Files: `src/research/tools/NoteTools.ts`, `tests/unit/note-tools.test.ts`

Dependencies: Task 1

Acceptance:
- Tool definition registered in `NOTE_MUTATION_TOOL_DEFINITIONS`
- `supports()` recognises `create_note`
- Creates file via `writer.createFile`; creates parent folders via `writer.ensureFolder`
- Returns `{ ok: true, path, created: true }` on success
- Returns `{ ok: false, reason: "already-exists" }` if file exists and `overwrite: false`
- Overwrites if `overwrite: true`
- Returns `{ ok: false, reason: "forbidden-path" }` for `.ixplorer/` paths
- Returns `{ ok: false, reason: "invalid-path" }` for non-`.md` paths
- Returns `{ ok: false, reason: "user-cancelled" }` when confirmation returns false
- Not registered when `writer` is absent

---

### Task 3 — `update_note` tool [x]
Implement `update_note` tool definition and handler.

Files: `src/research/tools/NoteTools.ts`, `tests/unit/note-tools.test.ts`

Dependencies: Task 1

Acceptance:
- Modes: `replace` (vault.modifyFile), `append` (vault.appendFile), `prepend` (read + write)
- Default mode is `replace`
- Returns `{ ok: false, reason: "not-found" }` if file does not exist
- Forbidden-path and invalid-path validation apply
- `user-cancelled` on confirmation rejection
- `prepend` non-atomicity documented in tool description

---

### Task 4 — `delete_note` tool [x]
Implement `delete_note` tool definition and handler.

Files: `src/research/tools/NoteTools.ts`, `tests/unit/note-tools.test.ts`

Dependencies: Task 1

Acceptance:
- Calls `writer.trashFile`
- Returns `{ ok: true, path, trashed: true }` on success
- Returns `{ ok: false, reason: "not-found" }` if file does not exist
- Forbidden-path validation applies (no `.md` restriction for delete)
- `user-cancelled` on confirmation rejection

---

### Task 5 — Registry availability flag [x]
Add `noteMutationAccess` to `ResearchToolAvailability` and `NoteToolAvailability`.
Filter mutation tools in `adaptNoteToolHandlers`.

Files: `src/research/tools/ResearchToolRegistry.ts`, `src/research/tools/createResearchToolRegistry.ts`

Dependencies: Task 2, 3, 4

Acceptance:
- `noteMutationAccess: boolean` in both availability types
- Default value `false` in `DEFAULT_AVAILABILITY`
- `adaptNoteToolHandlers` includes mutation tools only when `noteMutationAccess === true`

---

### Task 6 — Settings: noteMutationAccess [x]
Add `noteMutationAccess` to `ChatModelProfile` defaults.

Files: `src/settings/settings.ts`

Dependencies: Task 5

Acceptance:
- Field exists with default `false`
- Read/written through existing settings serialisation

---

### Task 7 — ObsidianVaultWriter + main.ts wiring [x]
Create `ObsidianVaultWriter` and pass it (with writer/confirmation) to `NoteToolService` in `main.ts`.

Files: `src/research/tools/ObsidianVaultWriter.ts` (new), `src/main.ts`

Dependencies: Task 5, 6

Acceptance:
- `ObsidianVaultWriter` implements `VaultWriter` via Obsidian `App.vault` API
- `main.ts` constructs `ObsidianVaultWriter` and passes it to `NoteToolService`
- `noteMutationAccess` read from profile settings
- Plugin builds without TypeScript errors
