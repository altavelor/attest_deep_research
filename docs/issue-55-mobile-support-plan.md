# Implementation Plan: Obsidian Mobile support (issue #55, stages 2–4)

## Scope and decisions

Stage 1 was delivered by PR #56. This plan completes the remaining issue scope.

- Desktop keeps native streaming transports and current indexing behaviour.
- Obsidian Mobile keeps direct `fetch` and SSE for chat and Responses providers
  that expose correct CORS headers. Non-streaming discovery and embedding calls use
  `requestUrl`, which avoids CORS without changing chat UX.
- Ollama and loopback OpenAI-compatible servers fail immediately on mobile with an
  actionable message. Reachable LAN endpoints remain allowed.
- Existing synced indexes remain readable on mobile. Destructive rebuilds require an
  explicit mobile confirmation; mobile indexing uses conservative PDF and embedding limits.
- Long-running indexing pauses when the mobile app becomes hidden and can be resumed
  through the existing controller path.

## Tasks

1. Mobile provider transport
   - Inject the platform-selected fetch implementation into chat, Responses,
     embedding, discovery, and capability-probe clients.
   - Preserve direct streaming for CORS-capable cloud chat providers.
   - Preserve abort and timeout behaviour and reject local providers before network I/O.
   - Verify with focused model-client, composition, settings, and fetch tests.

2. Mobile indexing policy
   - Reuse existing indexes without forcing rebuilds.
   - Require explicit confirmation for a mobile rebuild.
   - Reduce mobile embedding batches and PDF workload, and pause active indexing when
     the document becomes hidden.
   - Verify policy, controller lifecycle, and extractor selection with unit tests.

3. Mobile UI and release surface
   - Route external citations through an injectable Obsidian-safe opener.
   - Add narrow-screen, touch-target, and dynamic-viewport styles.
   - Remove `isDesktopOnly`, document supported/unsupported mobile behaviour, and add
     a manual iOS/Android release checklist.
   - Verify behavioural UI tests, style contracts, release checks, and bundle size.

4. Integration and review
   - Run `npm ci` and `npm run check`.
   - Inspect the complete diff and obtain an independent read-only review.
   - Resolve blocking findings and record any device-only validation limitation.

## Boundaries

- No dependency additions or settings migration.
- No change to the stage-1 index format or hashes.
- No claim of real-device validation unless it is actually performed.
- Publishing actions (commit, push, PR) remain separate and require explicit authorization.
