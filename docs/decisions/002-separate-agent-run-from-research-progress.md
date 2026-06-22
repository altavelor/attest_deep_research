# ADR-002: Separate the generic agent run from research-progress projection

## Status

Accepted.

## Date

2026-06-21

## Context

Deep reasoning requires several model and tool rounds, but the transport cannot know whether streamed text will become a provisional checkpoint or the final answer. Encoding research UI semantics in provider adapters would make behavior provider-specific and difficult to reuse.

OpenClaw demonstrates a useful generic boundary: a serialized agent run emits lifecycle, assistant, reasoning, and tool events, while delivery is handled separately. This project also needs stronger research-specific semantics than OpenClaw's general chat loop.

## Decision

- Introduce a provider-neutral, serialized `AgentRun` with one active run per chat.
- Give every event a `runId` so cancelled or replaced runs cannot mutate current state.
- Keep transport adapters limited to request/response dialect normalization.
- Project generic run events through `ResearchProgressProjector` into reasoning segments, provisional checkpoints, and a final answer.
- Freeze skills and tool policy for the lifetime of a run.
- Keep the existing saved chat schema as canonical persistence initially; do not require a gateway or full append-only event store.
- Preserve tool-call/result pairs and opaque identifiers during pruning or compaction.

## Consequences

The same loop can support OpenAI-compatible providers and future transports without provider checks in orchestration or UI. Research presentation can evolve without changing protocol adapters. The additional projector is intentional complexity, covered by pure transition tests.

We do not adopt OpenClaw's channel-specific delivery, gateway process, or full session infrastructure because they do not solve a current Obsidian plugin requirement.
