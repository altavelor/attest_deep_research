# ADR-001: Collapse deep-reasoning stages into one research-progress disclosure

## Status

Accepted

## Date

2026-06-21

## Context

Deep reasoning may require several model rounds:

```text
reasoning -> intermediate answer -> reasoning -> intermediate answer -> final answer
```

Rendering every intermediate answer as an ordinary assistant message would make provisional conclusions look final, create transcript noise, and complicate regeneration and persistence. Removing intermediate answers after finalization would hide useful evidence about how the result developed.

## Decision

Treat the complete sequence as one assistant turn.

- While the loop runs, reasoning and intermediate answers are visible in order.
- Intermediate answers are labelled provisional checkpoints.
- The final answer is rendered as the primary assistant content.
- After finalization, all reasoning and intermediate checkpoints collapse into one `Research progress` disclosure before the final answer.
- A user's explicit open/closed choice overrides automatic disclosure behavior.
- Reasoning and checkpoints are persisted separately from final assistant content and excluded from normal copy, export, compaction, title generation, and cross-turn history by default.

## Alternatives considered

### Separate assistant message for every intermediate answer

- Pros: Simple append-only transcript.
- Cons: Provisional output is easily mistaken for a final answer; chat becomes noisy; regeneration semantics are unclear.
- Rejected: Does not match the intended single-answer interaction.

### Delete intermediate answers after finalization

- Pros: Minimal final transcript.
- Cons: Loses useful progress information and makes debugging model/tool behavior harder.
- Rejected: Information loss is unnecessary when the stages can be collapsed.

### Keep every stage permanently expanded

- Pros: Maximum transparency.
- Cons: Large reasoning traces dominate the final answer and degrade scanability.
- Rejected: The final answer should remain primary.

## Consequences

Execution and presentation boundaries are defined by ADR-002. `AgentRun` emits generic events; `ResearchProgressProjector` owns this collapse behavior.

- The orchestration layer needs explicit intermediate checkpoint events and cannot use final assistant `content` as a temporary buffer.
- The assistant message schema must persist research progress separately from final content.
- The transcript renderer needs one stable disclosure containing an ordered stage timeline.
- Copy/history/export projections must explicitly exclude research progress unless a future feature requests it.
- Tests must cover live multi-round updates, final collapse, reload, cancellation, and user disclosure overrides.
