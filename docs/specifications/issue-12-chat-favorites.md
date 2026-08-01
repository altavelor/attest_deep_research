# Spec: Saved chat favorites

## Objective

Improve the saved-chat popover by adding History and Favorites tabs, while retaining every saved chat in History. Users can toggle a chat's favorite state with a star; the state survives reloads and a removal from Favorites never deletes chat history.

## Tech Stack

TypeScript, Obsidian UI APIs, filesystem-backed chat repository, Vitest, and CSS custom properties supplied by Obsidian.

## Commands

- Targeted tests: `npm test -- tests/unit/chat-store.test.ts tests/unit/chat-rendering.test.ts`
- Full validation: `npm run check`

## Project Structure

- `src/core/chat/savedChat.ts` — compatible saved-chat and summary data shapes.
- `src/application/ports/chat.ts` — persistence contract.
- `src/adapters/filesystem/FileChatRepository.ts` — favorite-state persistence.
- `src/apps/obsidian/ui/chat/history/` — popover tabs, rows, and CSS.
- `src/apps/obsidian/ui/chat/IxplorerChatView.ts` — UI state and service wiring.
- `tests/unit/` — behavioral persistence and UI-state tests.

## Code Style

Follow the existing functional rendering style and semantic design tokens:

```ts
const favoriteButton = actions.createEl("button", {
  cls: "ixplorer-chat__saved-action",
  attr: { type: "button", "aria-label": "Add chat to favorites" },
});
```

## Testing Strategy

Use focused Vitest tests for persisted favorite state, compatibility with legacy saved chats, and pure tab/list selection logic. Run the full repository check after implementation.

## Boundaries

- Always: preserve existing chats and their history; use existing `star` icon; test changed behavior.
- Ask first: add dependencies, change storage location, alter unrelated UI.
- Never: delete chats when only favorite state is toggled; break legacy saved-chat files.

## Success Criteria

- The popover has History and Favorites tabs.
- History retains all chats and marks favorites with an active yellow star.
- Favorites displays only favorite chats and permits removing a favorite.
- Favorite state persists and old saved-chat files remain loadable.
- The saved-chat surface is more visually opaque/readable.

## Implementation Plan

1. Add an optional, backward-compatible favorite flag to the chat model, summaries, repository contract, and filesystem adapter; verify with repository tests.
2. Add pure list/tab state helpers and a failing unit test for favorite filtering.
3. Render tabs and favorite actions, wire persistence through the chat view, and apply accessible CSS using existing color tokens.
4. Run targeted tests, then `npm run check`; review the final diff for correctness, architecture, security, and scope.

## Risks and Mitigations

| Risk                                      | Mitigation                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------------- |
| Existing JSON lacks the new flag          | Treat missing `isFavorite` as `false`; write it on the next save.          |
| Favorite action accidentally deletes data | Use a dedicated repository method and test that messages remain unchanged. |
| Re-render loses selected tab              | Store active tab in the chat view and pass it into the renderer.           |
