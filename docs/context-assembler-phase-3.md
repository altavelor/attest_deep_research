# Context Assembler Phase 3

Phase 3 moves evidence selection into a dedicated `EvidencePlanner` and adds manual adjacent chunk expansion from citations.

## Scope

- Plan final evidence across explicit, expanded, graph, retrieval, and web groups.
- Prefer local evidence by default, but reserve web budget when `indexAndWeb` is enabled.
- Boost web evidence for freshness questions when the `Use web for freshness questions` setting is enabled.
- Fall back to more web evidence when local evidence is weak.
- Let users expand a vault citation with `Expand around this`, then regenerate with the added neighboring chunks.
- Surface planner policy, web usage, dropped web chunks, and expanded citation counts in diagnostics.

## Out Of Scope

- Conversation compaction.
- Tool loop / function calling.
- Lazy-loaded skills.
- Web citation expansion.
- Multi-index UI changes.

## Evidence Policy

`EvidencePlanner` is a pure service. It receives already-collected evidence and returns the planned groups, final evidence order, and diagnostics.

Priority is:

1. Explicit context.
2. Manually expanded citation context.
3. Web first only for freshness policy.
4. Graph context.
5. Retrieval chunks.
6. Web for local-first and weak-local policies.

The planner supports these policies:

- `index-only`: local explicit, graph, and retrieval evidence only.
- `local-first`: local evidence first, with a small reserved web share when web search is enabled.
- `freshness`: web evidence receives earlier placement and a larger share.
- `weak-local`: web can fill more of the budget when explicit/graph/retrieval evidence is sparse.
- `web-only`: web evidence only.

## Citation Expansion

Citation expansion is manual. The existing retrieval path still uses automatic adjacent loading for top evidence. A user can open a vault citation, click `Expand around this`, and regenerate with the added neighboring chunks. The pending expansion is saved with the chat until it is used for regeneration.

## Diagnostics

The user-facing diagnostics block shows the planner policy, web intent when detected, web chunks used/dropped, and expanded citation chunks. The full raw JSON remains available in `Debug details`.
