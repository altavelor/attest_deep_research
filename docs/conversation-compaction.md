# Spec: Conversation Compaction

## Objective

Keep long chats from consuming the model context that should be available for retrieved evidence. Users can run `/compact`, and the app automatically compacts before a request when history would exceed the selected model context. The visible transcript remains intact, while prompt history uses a compact structured summary plus the most recent two user/assistant turns.

## Tech Stack

TypeScript Obsidian plugin with Vitest unit tests.

## Commands

- Test: `npm test -- --run`
- Targeted tests: `npm test -- tests/unit/chat-compaction.test.ts tests/unit/context-assembler.test.ts tests/unit/chat-store.test.ts --run`
- Build: `npm run build`

## Project Structure

- `src/chat/` stores saved chat schema and compaction logic.
- `src/research/` builds prompt history and context diagnostics.
- `src/ui/` handles `/compact`, automatic compaction, transcript rendering, and notices.
- `tests/unit/` contains unit coverage.

## Code Style

```ts
const summary = compactChatHistory(messages, {
  now: () => new Date("2026-06-10T10:00:00.000Z"),
});
```

Prefer pure helpers for compaction decisions, explicit schema guards for persisted data, and no UI-only state as the source of truth.

## Testing Strategy

Use Vitest for pure compaction behavior, prompt history conversion, schema compatibility, and context budget effects. UI behavior is covered through controller-level unit tests where practical.

## Boundaries

- Always: preserve full visible transcript; preserve references in `citedSourcesAlreadyUsed`; keep old saved chats loadable.
- Ask first: changing the number of recent turns retained; adding a separate summarization model setting.
- Never: delete user-visible messages during compaction; keep full old evidence arrays inside the compact summary marker.

## Success Criteria

- `/compact` creates or merges one compact summary marker and marks compacted old messages.
- Auto-compaction runs before answering when estimated history exceeds the selected model context, with a short status message.
- Prompt history excludes compacted old messages and includes the structured summary plus recent turns.
- Evidence budget increases after compaction because history tokens drop.
- Summary keeps important references from evidence and explicit paths/URLs in old messages.

## Open Questions

None. User decisions are recorded in the current task thread.
